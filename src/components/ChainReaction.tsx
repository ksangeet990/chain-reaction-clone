import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  createGameRoom,
  joinGameRoom,
  updateGameState,
  subscribeToGameRoom,
  checkGameRoom,
  signInWithGoogle,
  signOut,
  getCurrentUser,
  supabase,
  type GameRoom,
} from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function ChainReaction() {
  const [user, setUser] = useState<User | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [boardSize] = useState({ rows: 6, cols: 6 });
  const [board, setBoard] = useState<
    Array<Array<{ count: number; player: number | null }>>
  >([]);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [players] = useState([
    { id: 0, color: "#FF5252" }, // Red
    { id: 1, color: "#4CAF50" }, // Green
  ]);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [playerNumber, setPlayerNumber] = useState<number | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // resetGame()
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const currentUser = await getCurrentUser();
    setUser(currentUser);
  };

  useEffect(() => {
    if (roomId) {
      console.log("Room ID changed:", roomId, "Player Number:", playerNumber);

      let isSubscribed = true; // For cleanup

      // First fetch the current state
      const fetchCurrentState = async () => {
        const { data, error } = await supabase
          .from("game_rooms")
          .select("*")
          .eq("id", roomId)
          .single();

        if (!error && data && isSubscribed) {
          console.log("Initial state fetch:", {
            status: data.status,
            player2_id: data.player2_id,
            currentPlayer: data.current_state.currentPlayer,
            board: data.current_state.board,
          });

          const gameRoom = data as GameRoom;

          // Update all game states atomically
          const updates = () => {
            setBoard(gameRoom.current_state.board);
            setCurrentPlayer(gameRoom.current_state.currentPlayer);
            setGameOver(gameRoom.current_state.gameOver);
            setWinner(gameRoom.current_state.winner);
            setIsWaiting(gameRoom.status === "waiting");
          };
          updates();

          console.log("Initial state updated:", {
            currentPlayer: gameRoom.current_state.currentPlayer,
            status: gameRoom.status,
            player2_id: gameRoom.player2_id,
            playerNumber,
            isWaiting: gameRoom.status === "waiting",
            board: gameRoom.current_state.board,
          });
        }
      };

      fetchCurrentState();

      // Set up the subscription
      const subscription = subscribeToGameRoom(roomId, (gameRoom: GameRoom) => {
        if (!isSubscribed) return;

        console.log("Processing game room update:", {
          status: gameRoom.status,
          player2_id: gameRoom.player2_id,
          currentPlayer: gameRoom.current_state.currentPlayer,
          playerNumber,
          board: gameRoom.current_state.board,
        });

        if (!gameRoom.current_state) {
          console.error("Invalid game state received");
          return;
        }

        // Schedule state updates to run in the next tick
        setTimeout(() => {
          if (!isSubscribed) return;

          setBoard(gameRoom.current_state.board);
          setCurrentPlayer(gameRoom.current_state.currentPlayer);
          setGameOver(gameRoom.current_state.gameOver);
          setWinner(gameRoom.current_state.winner);
          setIsWaiting(gameRoom.status === "waiting");

          console.log("Game state updated:", {
            currentPlayer: gameRoom.current_state.currentPlayer,
            status: gameRoom.status,
            player2_id: gameRoom.player2_id,
            playerNumber,
            isWaiting: gameRoom.status === "waiting",
            board: gameRoom.current_state.board,
          });
        }, 0);
      });

      return () => {
        console.log("Cleaning up subscription for room:", roomId);
        isSubscribed = false;
        subscription.unsubscribe();
      };
    }
  }, [roomId, playerNumber]);

  const resetGame = () => {
    const newBoard = Array(boardSize.rows)
      .fill(null)
      .map(() =>
        Array(boardSize.cols)
          .fill(null)
          .map(() => ({ count: 0, player: null }))
      );
    setBoard(newBoard);
    setCurrentPlayer(0);
    setGameOver(false);
    setWinner(null);
  };

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Error signing in:", error);
      setError("Failed to sign in");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setUser(null);
      setRoomId(null);
      setPlayerNumber(null);
      setIsWaiting(false);
      resetGame();
    } catch (error) {
      console.error("Error signing out:", error);
      setError("Failed to sign out");
    }
  };

  const handleCreateRoom = async () => {
    if (!user) return;
    setIsJoining(true);
    setError(null);
    const newRoomId = await createGameRoom(user.id);
    if (newRoomId) {
      setRoomId(newRoomId);
      setPlayerNumber(0);
      setIsWaiting(true);
    } else {
      setError("Failed to create game room");
    }
    setIsJoining(false);
  };

  const handleJoinRoom = async () => {
    if (!joinRoomId || !user) return;
    setIsJoining(true);
    setError(null);

    const { exists, canJoin } = await checkGameRoom(joinRoomId);

    if (!exists) {
      setError("Game room does not exist");
      setIsJoining(false);
      return;
    }

    if (!canJoin) {
      setError("Cannot join this game room");
      setIsJoining(false);
      return;
    }

    const success = await joinGameRoom(joinRoomId, user.id);
    if (success) {
      setRoomId(joinRoomId);
      setPlayerNumber(1);
      // Don't set waiting state for player 2
    } else {
      setError("Failed to join game room");
    }
    setIsJoining(false);
  };

  const isCorner = (row: number, col: number) => {
    return (
      (row === 0 && col === 0) ||
      (row === 0 && col === boardSize.cols - 1) ||
      (row === boardSize.rows - 1 && col === 0) ||
      (row === boardSize.rows - 1 && col === boardSize.cols - 1)
    );
  };

  const isEdge = (row: number, col: number) => {
    return (
      row === 0 ||
      col === 0 ||
      row === boardSize.rows - 1 ||
      col === boardSize.cols - 1
    );
  };

  const getCriticalMass = (row: number, col: number) => {
    if (isCorner(row, col)) return 2;
    if (isEdge(row, col)) return 3;
    return 4;
  };

  const getAdjacentCells = (row: number, col: number) => {
    const adjacent = [];
    if (row > 0) adjacent.push({ row: row - 1, col });
    if (row < boardSize.rows - 1) adjacent.push({ row: row + 1, col });
    if (col > 0) adjacent.push({ row, col: col - 1 });
    if (col < boardSize.cols - 1) adjacent.push({ row, col: col + 1 });
    return adjacent;
  };

  const checkExplosion = (board: any[][], row: number, col: number) => {
    // Queue to store cells that need to be checked for explosion
    const queue: Array<{ row: number; col: number }> = [{ row, col }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const criticalMass = getCriticalMass(current.row, current.col);

      if (board[current.row][current.col].count >= criticalMass) {
        // Reduce the count by critical mass
        board[current.row][current.col].count -= criticalMass;

        // Clear player if no atoms remain
        if (board[current.row][current.col].count === 0) {
          board[current.row][current.col].player = null;
        }

        // Get adjacent cells and update them
        const adjacent = getAdjacentCells(current.row, current.col);

        adjacent.forEach(({ row: adjRow, col: adjCol }) => {
          board[adjRow][adjCol].count++;
          board[adjRow][adjCol].player = currentPlayer;

          // Add to queue only if this cell might explode
          if (board[adjRow][adjCol].count >= getCriticalMass(adjRow, adjCol)) {
            queue.push({ row: adjRow, col: adjCol });
          }
        });
      }
    }
  };

  const getActivePlayers = (board: any[][]) => {
    const active = new Set<number>();

    for (let row = 0; row < boardSize.rows; row++) {
      for (let col = 0; col < boardSize.cols; col++) {
        if (board[row][col].count > 0 && board[row][col].player !== null) {
          active.add(board[row][col].player);
        }
      }
    }

    return Array.from(active);
  };

  const getTotalAtoms = (board: any[][]) => {
    let total = 0;

    for (let row = 0; row < boardSize.rows; row++) {
      for (let col = 0; col < boardSize.cols; col++) {
        total += board[row][col].count;
      }
    }

    return total;
  };

  const handleCellClick = async (row: number, col: number) => {
    // Don't allow moves if it's not the player's turn or game is waiting/over
    if (gameOver || playerNumber !== currentPlayer || isWaiting) {
      console.log("Invalid move:", {
        gameOver,
        playerNumber,
        currentPlayer,
        isWaiting,
      });
      return;
    }

    // Don't allow capturing opponent's cells
    if (board[row][col].count > 0 && board[row][col].player !== currentPlayer) {
      console.log("Cannot capture opponent cell");
      return;
    }

    console.log("Processing move:", { row, col, playerNumber, currentPlayer });

    const newBoard = JSON.parse(JSON.stringify(board));
    newBoard[row][col].count++;
    newBoard[row][col].player = currentPlayer;

    checkExplosion(newBoard, row, col);

    const activePlayers = getActivePlayers(newBoard);
    const newGameOver =
      activePlayers.length === 1 && getTotalAtoms(newBoard) > 1;
    const newWinner = newGameOver ? activePlayers[0] : null;
    const nextPlayer = (currentPlayer + 1) % players.length;

    const newState = {
      board: newBoard,
      currentPlayer: nextPlayer,
      gameOver: newGameOver,
      winner: newWinner,
    };

    console.log("Updating game state:", newState);

    const success = await updateGameState(roomId!, newState);
    if (!success) {
      console.error("Failed to update game state");
    }
  };

  const renderAtoms = (count: number, player: number | null) => {
    if (count === 0) return null;

    const color = player !== null ? players[player].color : "#ccc";

    switch (count) {
      case 1:
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            ></div>
          </div>
        );
      case 2:
        return (
          <div className="absolute inset-0 grid grid-cols-2 gap-1 p-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            ></div>
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            ></div>
          </div>
        );
      case 3:
        return (
          <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-1 p-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            ></div>
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            ></div>
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            ></div>
          </div>
        );
      default:
        return (
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-1 p-1">
            {Array(count)
              .fill(null)
              .map((_, i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                ></div>
              ))}
          </div>
        );
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
        <h1 className="mb-8 text-3xl font-bold text-gray-800">
          Chain Reaction Online
        </h1>
        <div className="flex flex-col gap-4 w-full max-w-md">
          <Button onClick={handleSignIn} className="w-full">
            Sign in with Google
          </Button>
          {error && (
            <div className="px-4 py-2 text-red-800 bg-red-100 rounded-md">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
        <div className="flex items-center justify-between w-full max-w-md mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            Chain Reaction Online
          </h1>
          <Button
            onClick={handleSignOut}
            variant="outline"
            className="px-3 py-1"
          >
            Sign Out
          </Button>
        </div>
        <div className="flex flex-col gap-4 w-full max-w-md">
          <div className="text-sm text-gray-600">
            Signed in as: {user.email}
          </div>
          <Button
            onClick={handleCreateRoom}
            className="w-full"
            disabled={isJoining}
          >
            {isJoining ? "Creating Room..." : "Create New Room"}
          </Button>
          <div className="relative">
            <div className="absolute inset-x-0 -top-6 text-center">
              <span className="text-gray-500">- or -</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="Enter Room ID"
                className="flex-1 px-4 py-2 border rounded-md"
              />
              <Button
                onClick={handleJoinRoom}
                disabled={!joinRoomId || isJoining}
              >
                {isJoining ? "Joining..." : "Join Room"}
              </Button>
            </div>
          </div>
          {error && (
            <div className="px-4 py-2 text-red-800 bg-red-100 rounded-md">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="flex items-center justify-between w-full max-w-2xl mb-4">
        <h1 className="text-3xl font-bold text-gray-800">
          Chain Reaction Online
        </h1>
        <Button onClick={handleSignOut} variant="outline" className="px-3 py-1">
          Sign Out
        </Button>
      </div>

      {isWaiting ? (
        <div className="mb-4 px-4 py-2 bg-blue-100 text-blue-800 rounded-md">
          <p>Waiting for opponent to join...</p>
          <p className="mt-2 text-sm">
            Share this Room ID:{" "}
            <span className="font-mono font-bold">{roomId}</span>
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-4">
            {players.map((player) => (
              <div
                key={player.id}
                className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                  currentPlayer === player.id && !gameOver
                    ? "ring-2 ring-offset-2 ring-[" + player.color + "]"
                    : ""
                } ${playerNumber === player.id ? "font-bold" : ""}`}
                style={{
                  backgroundColor: `${player.color}20`,
                  color: player.color,
                }}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: player.color }}
                ></div>
                <span className="font-medium">
                  Player {player.id + 1}
                  {playerNumber === player.id ? " (You)" : ""}
                </span>
              </div>
            ))}
          </div>

          {gameOver && winner !== null && (
            <div className="mb-4 px-4 py-2 bg-yellow-100 text-yellow-800 rounded-md">
              Player {winner + 1} wins!
            </div>
          )}

          <div className="mb-6 overflow-hidden border-2 border-gray-300 rounded-lg">
            <div
              className="grid gap-px bg-gray-300"
              style={{
                gridTemplateColumns: `repeat(${boardSize.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${boardSize.rows}, minmax(0, 1fr))`,
              }}
            >
              {board.map((row, rowIndex) =>
                row.map((cell, colIndex) => (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    className="relative flex items-center justify-center w-12 h-12 bg-white cursor-pointer transition-colors hover:bg-gray-100"
                    onClick={() => handleCellClick(rowIndex, colIndex)}
                  >
                    {renderAtoms(cell.count, cell.player)}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <Button
              onClick={async () => {
                const newBoard = Array(boardSize.rows)
                  .fill(null)
                  .map(() =>
                    Array(boardSize.cols)
                      .fill(null)
                      .map(() => ({ count: 0, player: null }))
                  );
                
                const newState = {
                  board: newBoard,
                  currentPlayer: 0,
                  gameOver: false,
                  winner: null,
                };
                
                const success = await updateGameState(roomId!, newState);
                if (!success) {
                  console.error("Failed to reset game state");
                }
              }}
              variant="outline"
              className="px-6"
              disabled={!gameOver || winner === null}
            >
              Reset Game
            </Button>
            
            <Button
              onClick={() => {
                setRoomId(null);
                setPlayerNumber(null);
                setIsWaiting(false);
                resetGame();
              }}
              className="px-6"
            >
              Leave Game
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
