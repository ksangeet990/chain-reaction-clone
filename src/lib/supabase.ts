import { createClient, User } from "@supabase/supabase-js";

// Initialize the Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Auth functions
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export interface GameState {
  board: Array<Array<{ count: number; player: number | null }>>;
  currentPlayer: number;
  gameOver: boolean;
  winner: number | null;
}

// Game room types
export interface GameRoom {
  id: string;
  created_at: string;
  player1_id: string;
  player2_id: string | null;
  current_state: GameState;
  game_over: boolean;
  winner: number | null;
  status: "waiting" | "playing" | "finished";
}

// Helper function to validate UUID
function isValidUUID(uuid: string) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Game room functions
export async function createGameRoom(userId: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || user.id !== userId) {
    console.error("User not authenticated or ID mismatch");
    return null;
  }

  const initialState: GameState = {
    board: Array(6)
      .fill(null)
      .map(() =>
        Array(6)
          .fill(null)
          .map(() => ({ count: 0, player: null }))
      ),
    currentPlayer: 0,
    gameOver: false,
    winner: null,
  };

  const { data, error } = await supabase
    .from("game_rooms")
    .insert([
      {
        player1_id: userId,
        current_state: initialState,
        game_over: false,
        winner: null,
        status: "waiting",
      },
    ])
    .select("id")
    .single();

  if (error) {
    console.error("Error creating game room:", error);
    return null;
  }

  return data.id;
}

export async function joinGameRoom(
  roomId: string,
  userId: string
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || user.id !== userId) {
    console.error("User not authenticated or ID mismatch");
    return false;
  }

  // First check if the room exists and is joinable
  const { data: room, error: checkError } = await supabase
    .from("game_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (checkError || !room) {
    console.error("Error checking game room:", checkError);
    return false;
  }

  // Don't allow the same player to join their own room
  if (room.player1_id === userId) {
    console.error("Cannot join your own game room");
    return false;
  }

  // Verify the room is joinable
  if (room.status !== "waiting" || room.player2_id !== null) {
    console.error("Room is not available for joining");
    return false;
  }

  // Update room with player 2 and change status to playing
  const { error } = await supabase
    .from("game_rooms")
    .update({
      player2_id: userId,
      status: "playing",
      current_state: {
        ...room.current_state,
        currentPlayer: 0, // Ensure we start with player 1
      },
    })
    .eq("id", roomId)
    .select();

  if (error) {
    console.error("Error joining game room:", error);
    return false;
  }

  return true;
}

export async function updateGameState(
  roomId: string,
  newState: GameState
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) {
    console.error("User not authenticated");
    return false;
  }

  if (!isValidUUID(roomId)) {
    console.error("Invalid UUID format for roomId");
    return false;
  }

  console.log("Updating game state:", { roomId, newState });

  // First get the current room state
  const { data: currentRoom, error: fetchError } = await supabase
    .from("game_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (fetchError) {
    console.error("Error fetching current room state:", fetchError);
    return false;
  }

  // Perform the update with the complete state
  const { error } = await supabase
    .from("game_rooms")
    .update({
      current_state: {
        ...currentRoom.current_state,
        ...newState,
      },
      game_over: newState.gameOver,
      winner: newState.winner,
      status: newState.gameOver ? "finished" : "playing",
    })
    .eq("id", roomId);

  if (error) {
    console.error("Error updating game state:", error);
    return false;
  }

  console.log("Game state updated successfully");
  return true;
}

export function subscribeToGameRoom(
  roomId: string,
  callback: (gameRoom: GameRoom) => void
) {
  if (!isValidUUID(roomId)) {
    console.error("Invalid UUID format for roomId");
    return {
      unsubscribe: () => {},
    };
  }

  console.log("Setting up subscription for room:", roomId);

  // First fetch the current state
  supabase
    .from("game_rooms")
    .select("*")
    .eq("id", roomId)
    .single()
    .then(({ data, error }) => {
      if (!error && data) {
        const gameRoom = data as GameRoom;
        console.log("Initial fetch in subscription:", {
          status: gameRoom.status,
          player2_id: gameRoom.player2_id,
          currentPlayer: gameRoom.current_state.currentPlayer,
        });
        callback(gameRoom);
      }
    });

  // Set up real-time subscription
  const channel = supabase
    .channel(`game_room:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "game_rooms",
        filter: `id=eq.${roomId}`,
      },
      async (payload) => {
        console.log("Received realtime update:", payload);

        if (payload.eventType === "DELETE") {
          console.log("Ignoring DELETE event");
          return;
        }

        // Fetch the latest state to ensure consistency
        const { data, error } = await supabase
          .from("game_rooms")
          .select("*")
          .eq("id", roomId)
          .single();

        if (error) {
          console.error("Error fetching latest state:", error);
          return;
        }

        const gameRoom = data as GameRoom;
        if (gameRoom && gameRoom.current_state) {
          console.log("Processing realtime update:", {
            status: gameRoom.status,
            player2_id: gameRoom.player2_id,
            currentPlayer: gameRoom.current_state.currentPlayer,
            board: gameRoom.current_state.board,
          });
          callback(gameRoom);
        }
      }
    )
    .subscribe((status, err) => {
      if (err) {
        console.error("Subscription error:", err);
      } else {
        console.log("Subscription status:", status);
      }
    });

  return {
    unsubscribe: () => {
      console.log("Unsubscribing from room:", roomId);
      channel.unsubscribe();
    },
  };
}

export async function checkGameRoom(
  roomId: string
): Promise<{ exists: boolean; canJoin: boolean }> {
  const user = await getCurrentUser();
  if (!user) {
    console.error("User not authenticated");
    return { exists: false, canJoin: false };
  }

  if (!isValidUUID(roomId)) {
    return { exists: false, canJoin: false };
  }

  const { data, error } = await supabase
    .from("game_rooms")
    .select("player2_id, status")
    .eq("id", roomId)
    .single();

  if (error || !data) {
    return { exists: false, canJoin: false };
  }

  return {
    exists: true,
    canJoin: data.status === "waiting" && data.player2_id === null,
  };
}
