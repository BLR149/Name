import { useState, useEffect, useCallback, useRef } from 'react'
import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import './App.css'

type GameState = 'landing' | 'online-menu' | 'lobby' | 'input' | 'playing' | 'won' | 'lost' | 'match-over'
type TurnPhase = 'waiting' | 'setting' | 'guessing' | 'round-end'

interface Player {
  id: string
  name: string
  isHost: boolean
  score: number
}

interface NetworkMessage {
  type: 'SYNC_STATE' | 'GUESS_LETTER' | 'PLAYER_JOIN' | 'START_GAME' | 'UPDATE_NAME' | 'SET_WORD' | 'UPDATE_BOARD' | 'ROUND_END' | 'START_ROUND' | 'MATCH_OVER'
  payload: any
}

const DEFAULT_GAME_NAME = "TOLLYWOOD"
const QWERTY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"]
]
const ALL_LETTERS = QWERTY_ROWS.flat()

const generateId = () => Math.random().toString(36).substring(2, 8).toUpperCase()
const generateRandomName = () => `Player-${Math.floor(Math.random() * 9000) + 1000}`

function App() {
  // Game Logic States
  const [gameState, setGameState] = useState<GameState>('landing')
  const [movieName, setMovieName] = useState("")
  const [gameWord, setGameWord] = useState(DEFAULT_GAME_NAME)
  const [inputValue, setInputValue] = useState("")
  const [gameWordInput, setGameWordInput] = useState("")
  const [guessedLetters, setGuessedLetters] = useState<Set<string>>(new Set())
  const [wrongLetters, setWrongLetters] = useState<string[]>([])
  const [wrongGuesses, setWrongGuesses] = useState(0)

  // Online & Turn States
  const [isOnline, setIsOnline] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [roomId, setRoomId] = useState("")
  const [playerName, setPlayerName] = useState(generateRandomName())
  const [players, setPlayers] = useState<Player[]>([])
  const [currentTurnId, setCurrentTurnId] = useState("")
  const [targetPoints, setTargetPoints] = useState(5)
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('waiting')
  const [winnerName, setWinnerName] = useState("")
  
  // Networking Refs (To avoid stale closures in listeners)
  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<{ [key: string]: DataConnection }>({})
  const hostConnRef = useRef<DataConnection | null>(null)
  const isHostRef = useRef(false)
  const gameStateRef = useRef<GameState>('landing')
  const playersRef = useRef<Player[]>([])
  const currentTurnIdRef = useRef("")

  // Keep refs in sync
  useEffect(() => { isHostRef.current = isHost }, [isHost])
  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { playersRef.current = players }, [players])
  useEffect(() => { currentTurnIdRef.current = currentTurnId }, [currentTurnId])

  const isGuessable = (char: string) => /[A-Z]/.test(char)

  // --- Network Logic ---

  const broadcast = useCallback((message: NetworkMessage) => {
    console.log('Broadcasting:', message.type, message.payload)
    Object.values(connectionsRef.current).forEach(conn => {
      if (conn.open) conn.send(message)
    })
  }, [])

  const syncStateToAll = useCallback(() => {
    if (!isHostRef.current) return
    broadcast({
      type: 'SYNC_STATE',
      payload: {
        movieName,
        gameWord,
        guessedLetters: Array.from(guessedLetters),
        wrongLetters,
        wrongGuesses,
        gameState,
        players: playersRef.current,
        currentTurnId: currentTurnIdRef.current,
        targetPoints,
        turnPhase
      }
    })
  }, [movieName, gameWord, guessedLetters, wrongLetters, wrongGuesses, gameState, targetPoints, turnPhase, broadcast])

  // Refactor handleGuess to use functional updates and check isHostRef
  const handleGuess = useCallback((letter: string, fromNetwork = false) => {
    if (gameStateRef.current !== 'playing') return
    
    // Only the setter should NOT be able to guess in online mode
    const isSetter = isOnline && currentTurnIdRef.current === (peerRef.current?.id || "")
    if (isSetter && !fromNetwork) return

    if (isOnline && !isHostRef.current && !fromNetwork) {
      console.log('Sending guess to host:', letter)
      hostConnRef.current?.send({ type: 'GUESS_LETTER', payload: { letter } })
      return
    }

    // If host is NOT the setter, they must relay the guess to the active setter
    if (isOnline && isHostRef.current && currentTurnIdRef.current !== peerRef.current?.id) {
      const setterConn = connectionsRef.current[currentTurnIdRef.current]
      if (setterConn) {
        setterConn.send({ type: 'GUESS_LETTER', payload: { letter } })
      }
      return
    }

    // Process guess locally (Setter or Offline)
    setGuessedLetters(prev => {
      if (prev.has(letter)) return prev
      const next = new Set(prev)
      next.add(letter)
      return next
    })
  }, [isOnline])

  const handleData = useCallback((data: any, conn: DataConnection) => {
    const msg = data as NetworkMessage
    console.log('Received message:', msg.type, 'from', conn.peer)
    
    if (isHostRef.current) {
      switch (msg.type) {
        case 'PLAYER_JOIN':
          console.log('Player joining:', msg.payload.name, 'from', conn.peer)
          setPlayers(prev => {
            if (prev.find(p => p.id === conn.peer)) return prev
            const newPlayers = [...prev, { id: conn.peer, name: msg.payload.name, isHost: false, score: 0 }]
            setTimeout(() => {
              broadcast({
                type: 'SYNC_STATE',
                payload: {
                  movieName: movieNameRef.current,
                  gameWord: gameWordRef.current,
                  guessedLetters: Array.from(guessedLetters),
                  wrongLetters,
                  wrongGuesses,
                  gameState: gameStateRef.current,
                  players: newPlayers,
                  currentTurnId: currentTurnIdRef.current,
                  targetPoints,
                  turnPhase
                }
              })
            }, 100)
            return newPlayers
          })
          break
        case 'UPDATE_NAME':
          setPlayers(prev => {
            const newPlayers = prev.map(p => p.id === conn.peer ? { ...p, name: msg.payload.name } : p)
            return newPlayers
          })
          break
        case 'GUESS_LETTER':
          // Relay or handle
          handleGuess(msg.payload.letter, true)
          break
        case 'SET_WORD':
          console.log('Word set by setter:', msg.payload.movieName);
          // 1. Update Host's local state
          setMovieName(msg.payload.movieName)
          setGameWord(msg.payload.gameWord)
          setGameState('playing')
          setTurnPhase('guessing')
          setGuessedLetters(new Set())
          setWrongLetters([])
          setWrongGuesses(0)
          
          // 2. Immediately broadcast updated state to EVERYONE
          setTimeout(() => {
            broadcast({
              type: 'SYNC_STATE',
              payload: {
                movieName: msg.payload.movieName,
                gameWord: msg.payload.gameWord,
                guessedLetters: [],
                wrongLetters: [],
                wrongGuesses: 0,
                gameState: 'playing',
                players: playersRef.current,
                currentTurnId: currentTurnIdRef.current,
                targetPoints,
                turnPhase: 'guessing'
              }
            });
          }, 100);
          break
        case 'ROUND_END':
          handleRoundEnd(msg.payload.winnerId)
          break
        case 'UPDATE_BOARD':
          console.log('Board update received from setter')
          const incomingGuessed = msg.payload.guessedLetters;
          const incomingWrong = msg.payload.wrongLetters;
          
          setGuessedLetters(prev => {
            if (JSON.stringify(Array.from(prev)) === JSON.stringify(incomingGuessed)) return prev;
            return new Set(incomingGuessed);
          });
          setWrongLetters(prev => {
            if (JSON.stringify(prev) === JSON.stringify(incomingWrong)) return prev;
            return incomingWrong;
          });
          setWrongGuesses(msg.payload.wrongGuesses);
          break
      }
    } else {
      switch (msg.type) {
        case 'SYNC_STATE':
          setMovieName(msg.payload.movieName)
          setGameWord(msg.payload.gameWord)
          setGuessedLetters(prev => {
            if (JSON.stringify(Array.from(prev)) === JSON.stringify(msg.payload.guessedLetters)) return prev;
            return new Set(msg.payload.guessedLetters);
          })
          setWrongLetters(prev => {
            if (JSON.stringify(prev) === JSON.stringify(msg.payload.wrongLetters)) return prev;
            return msg.payload.wrongLetters;
          })
          setWrongGuesses(msg.payload.wrongGuesses)
          setGameState(msg.payload.gameState)
          setPlayers(msg.payload.players)
          setCurrentTurnId(msg.payload.currentTurnId)
          setTargetPoints(msg.payload.targetPoints)
          setTurnPhase(msg.payload.turnPhase)
          break
        case 'START_GAME':
          console.log('Match started by host!')
          setTargetPoints(msg.payload.targetPoints)
          setCurrentTurnId(msg.payload.currentTurnId)
          setGameState('input')
          setTurnPhase('setting')
          setMovieName("")
          setInputValue("")
          setGameWordInput("")
          setGuessedLetters(new Set())
          setWrongLetters([])
          setWrongGuesses(0)
          break
        case 'GUESS_LETTER':
          // Client is the active setter, process the relayed guess
          handleGuess(msg.payload.letter, true)
          break
      }
    }
  }, [handleGuess, syncStateToAll, guessedLetters, wrongLetters, wrongGuesses, targetPoints, turnPhase]) 

  const handleRoundEnd = useCallback((winnerId: string) => {
    if (!isHostRef.current) return

    setPlayers(prev => {
      let newPlayers;
      if (winnerId === 'GUESSERS') {
        // Give point to all players who are NOT the setter
        newPlayers = prev.map(p => p.id !== currentTurnIdRef.current ? { ...p, score: p.score + 1 } : p)
      } else {
        newPlayers = prev.map(p => p.id === winnerId ? { ...p, score: p.score + 1 } : p)
      }
      
      const winner = newPlayers.find(p => p.score >= targetPoints)
      
      if (winner) {
        setWinnerName(winner.name)
        setGameState('match-over')
      } else {
        // Start next round
        const currentIndex = prev.findIndex(p => p.id === currentTurnIdRef.current)
        const nextIndex = (currentIndex + 1) % prev.length
        const nextPlayer = prev[nextIndex]
        
        setCurrentTurnId(nextPlayer.id)
        setGameState('input') // Moves setter to word entry screen
        setTurnPhase('setting')
        setMovieName("")
        setInputValue("")
        setGameWordInput("")
        setGuessedLetters(new Set())
        setWrongLetters([])
        setWrongGuesses(0)
      }
      return newPlayers
    })
  }, [targetPoints])

  const handleStartGame = (e?: React.FormEvent) => {
    e?.preventDefault()
    
    const isSetter = !isOnline || currentTurnId === (peerRef.current?.id || "")
    if (!isSetter) return

    const nameToGuess = (inputValue || "").trim().toUpperCase()
    
    if (nameToGuess) {
      if (isOnline) {
        if (isHost) {
          setMovieName(nameToGuess)
          const customWord = gameWordInput.trim().toUpperCase() || DEFAULT_GAME_NAME
          setGameWord(customWord)
          setGameState('playing')
          setTurnPhase('guessing')
          setInputValue("")
          setGameWordInput("")
          setGuessedLetters(new Set())
          setWrongLetters([])
          setWrongGuesses(0)
        } else {
          hostConnRef.current?.send({
            type: 'SET_WORD',
            payload: { movieName: nameToGuess, gameWord: gameWordInput.trim().toUpperCase() || DEFAULT_GAME_NAME }
          })
          setInputValue("")
          setGameWordInput("")
        }
      } else {
        setMovieName(nameToGuess)
        const customWord = gameWordInput.trim().toUpperCase() || DEFAULT_GAME_NAME
        setGameWord(customWord)
        setGameState('playing')
        setInputValue("")
        setGameWordInput("")
        setGuessedLetters(new Set())
        setWrongLetters([])
        setWrongGuesses(0)
      }
    }
  }

  // Need a ref for movieName and gameWord for the logic inside guessedLetters effect or handleGuess
  const movieNameRef = useRef("")
  const gameWordRef = useRef(DEFAULT_GAME_NAME)
  useEffect(() => { movieNameRef.current = movieName }, [movieName])
  useEffect(() => { gameWordRef.current = gameWord }, [gameWord])

  const startGameMatch = () => {
    if (!isHost) return
    
    // Pick first player as setter (usually the host)
    const firstSetter = players[0].id
    setCurrentTurnId(firstSetter)
    setGameState('input')
    setTurnPhase('setting')
    setMovieName("")
    setGuessedLetters(new Set())
    setWrongLetters([])
    setWrongGuesses(0)
    
    broadcast({
      type: 'START_GAME',
      payload: { targetPoints, currentTurnId: firstSetter }
    })
  }

  // Centralized logic for wrong guesses (Active Setter or Offline)
  useEffect(() => {
    const isSetter = !isOnline || currentTurnId === (peerRef.current?.id || "")
    if (!isSetter) return 

    const lastGuessed = Array.from(guessedLetters).pop()
    if (!lastGuessed || !movieName) return

    if (!movieName.includes(lastGuessed)) {
      setWrongLetters(prev => {
        if (prev.includes(lastGuessed)) return prev
        const newWrong = [...prev, lastGuessed]
        setWrongGuesses(newWrong.length)
        if (newWrong.length >= gameWord.length) {
          // Setter wins (Guesser failed)
          if (isOnline) {
            console.log('Setter wins round!')
            if (isHost) handleRoundEnd(currentTurnId)
            else hostConnRef.current?.send({ type: 'ROUND_END', payload: { winnerId: currentTurnId } })
          } else {
            setGameState('lost')
          }
        }
        return newWrong
      })
    }
  }, [guessedLetters, movieName, gameWord, isOnline, isHost, currentTurnId, handleRoundEnd])

  // Win condition check (Active Setter or Offline)
  useEffect(() => {
    const isSetter = !isOnline || currentTurnId === (peerRef.current?.id || "")
    if (isSetter && gameState === 'playing' && movieName) {
      const movieChars = movieName.split("")
      const allGuessed = movieChars.every(char => 
        !isGuessable(char) || guessedLetters.has(char)
      )
      if (allGuessed) {
        // Guesser wins
        if (isOnline) {
          console.log('Guesser wins round!')
          if (isHost) {
            handleRoundEnd('GUESSERS')
          } else {
            hostConnRef.current?.send({ type: 'ROUND_END', payload: { winnerId: 'GUESSERS' } })
          }
        } else {
          setGameState('won')
        }
      }
    }
  }, [guessedLetters, movieName, gameState, isOnline, isHost, currentTurnId, handleRoundEnd, players])

  const resetGame = () => {
    if (isOnline) {
      if (isHost) {
        setPlayers(prev => prev.map(p => ({ ...p, score: 0 })))
        setWinnerName("")
        setGameState('lobby')
        setTurnPhase('waiting')
        syncStateToAll()
      }
      return
    }
    
    setGameState('input')
    setMovieName("")
    setInputValue("")
    setGameWordInput("")
    setGuessedLetters(new Set())
    setWrongLetters([])
    setWrongGuesses(0)
  }

  // Keep host name in sync in the players list
  useEffect(() => {
    if (isHost && isOnline && peerRef.current?.id) {
      setPlayers(prev => prev.map(p => p.id === peerRef.current?.id ? { ...p, name: playerName } : p))
    }
  }, [playerName, isHost, isOnline])

  // Send name updates to host (Clients only) - Debounced to prevent disconnects
  useEffect(() => {
    if (!isHost && isOnline && hostConnRef.current?.open) {
      const timeout = setTimeout(() => {
        hostConnRef.current?.send({ type: 'UPDATE_NAME', payload: { name: playerName } })
      }, 500)
      return () => clearTimeout(timeout)
    }
  }, [playerName, isHost, isOnline])

  // Push board updates to host (Active Client-Setter only)
  useEffect(() => {
    if (isOnline && !isHost && currentTurnId === peerRef.current?.id && gameState === 'playing') {
      hostConnRef.current?.send({
        type: 'UPDATE_BOARD',
        payload: {
          guessedLetters: Array.from(guessedLetters),
          wrongLetters,
          wrongGuesses
        }
      })
    }
  }, [guessedLetters, wrongLetters, wrongGuesses, isOnline, isHost, currentTurnId, gameState])

  // Broadcast state from host to all clients whenever it changes
  useEffect(() => {
    if (isOnline && isHost) {
      syncStateToAll()
    }
  }, [guessedLetters, wrongLetters, wrongGuesses, gameState, turnPhase, players, currentTurnId, targetPoints, isOnline, isHost, syncStateToAll])

  // initialization & Peer Setup

  const setupPeer = useCallback((id?: string) => {
    console.log('Setting up peer...', id || 'random id')
    if (peerRef.current) peerRef.current.destroy()

    const peer = id ? new Peer(id) : new Peer()
    peerRef.current = peer

    peer.on('open', (peerId) => {
      console.log('Peer opened with ID:', peerId)
      setRoomId(peerId)
      if (id) {
        setPlayers([{ id: peerId, name: playerName, isHost: true, score: 0 }])
      }
    })

    peer.on('connection', (conn) => {
      console.log('Incoming connection from:', conn.peer)
      
      conn.on('open', () => {
        if (!isHostRef.current) {
          console.warn('Rejecting connection: Not a host')
          conn.close()
          return
        }
        
        connectionsRef.current[conn.peer] = conn
        // Send initial state immediately
        conn.send({
          type: 'SYNC_STATE',
          payload: {
            movieName: movieNameRef.current,
            gameWord: gameWordRef.current,
            guessedLetters: Array.from(guessedLetters),
            wrongLetters,
            wrongGuesses,
            gameState: gameStateRef.current,
            players: playersRef.current,
            currentTurnId: currentTurnIdRef.current,
            targetPoints,
            turnPhase
          }
        })
      })

      conn.on('data', (data) => handleData(data, conn))
      
      conn.on('close', () => {
        console.log('Connection closed:', conn.peer)
        delete connectionsRef.current[conn.peer]
        setPlayers(prev => prev.filter(p => p.id !== conn.peer))
      })

      conn.on('error', (err) => {
        console.error('Connection error:', err)
      })
    })

    peer.on('error', (err) => {
      console.error('Peer error:', err)
      if (err.type === 'peer-unavailable') {
        alert('Room not found or host is offline.')
        setGameState('landing')
      }
    })

    return peer
  }, [playerName, handleData, guessedLetters, wrongLetters, wrongGuesses, targetPoints, turnPhase])

  const createRoom = () => {
    setIsOnline(true)
    setIsHost(true)
    setGameState('lobby')
    const rid = generateId()
    setupPeer(rid)
  }

  const joinRoom = (rid: string) => {
    console.log('Joining room:', rid)
    setIsOnline(true)
    setIsHost(false)
    setGameState('lobby')
    setRoomId(rid)
    
    if (peerRef.current) peerRef.current.destroy()
    const peer = new Peer()
    peerRef.current = peer

    peer.on('open', (myId) => {
      console.log('My peer ID:', myId)
      const conn = peer.connect(rid)
      hostConnRef.current = conn
      
      conn.on('open', () => {
        console.log('Connected to host')
        conn.send({ type: 'PLAYER_JOIN', payload: { name: playerName } })
      })

      conn.on('data', (data) => handleData(data, conn))

      conn.on('close', () => {
        console.warn('Host disconnected')
        alert('Disconnected from host.')
        window.location.href = window.location.origin + window.location.pathname
      })

      conn.on('error', (err) => {
        console.error('Host connection error:', err)
      })
    })

    peer.on('error', (err) => {
      console.error('Peer join error:', err)
    })
  }

  const copyRoomLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`
    navigator.clipboard.writeText(url)
    alert("Link copied to clipboard!")
  }

  // Handle URL join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (room && gameState === 'landing') {
      joinRoom(room)
    }
  }, [gameState, joinRoom])

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (gameState !== 'playing') return
      
      const key = event.key.toUpperCase()
      if (ALL_LETTERS.includes(key)) {
        handleGuess(key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [gameState, handleGuess])

  // --- Rendering ---

  const renderScoreboard = () => (
    <div className="scoreboard">
      <h3>Scores (Target: {targetPoints})</h3>
      <div className="scores-grid">
        {players.map(p => (
          <div key={p.id} className={`score-item ${p.id === currentTurnId ? 'active-setter' : ''}`}>
            <span className="player-name">{p.name}</span>
            <span className="player-score">{p.score}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const renderTitle = () => {
    const currentWord = (gameState === 'input' && gameWordInput.trim()) 
      ? gameWordInput.trim().toUpperCase() 
      : gameWord

    return (
      <div className="title-section">
        <div className="title">
          {currentWord.split("").map((letter, index) => (
            <div key={index} className="title-letter-container">
              <div className="wrong-letter-above">
                {wrongLetters[index] || ""}
              </div>
              <div className={`title-letter-box ${index < wrongGuesses ? 'striked' : ''}`}>
                <span className="title-letter">{letter}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderMovieBlanks = (isInputPreview = false) => {
    const nameToRender = isInputPreview ? inputValue : movieName
    if (!nameToRender) return null

    return (
      <div className={`movie-blanks ${isInputPreview ? 'preview' : ''}`}>
        {nameToRender.split("").map((char, index) => {
          if (char === " ") {
            return <div key={index} className="space" />
          }
          if (!isGuessable(char.toUpperCase()) && !isInputPreview) {
            return <div key={index} className="blank special-char">{char}</div>
          }
          
          const isGuessed = guessedLetters.has(char.toUpperCase())
          return (
            <div key={index} className="blank">
              {isGuessed || isInputPreview ? (isInputPreview ? "_" : char) : "_"}
            </div>
          )
        })}
      </div>
    )
  }

  const renderKeyboard = () => {
    return (
      <div className="keyboard-qwerty">
        {QWERTY_ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="keyboard-row">
            {row.map(letter => (
              <button
                key={letter}
                className="key-btn"
                onClick={() => handleGuess(letter)}
                disabled={guessedLetters.has(letter)}
              >
                {letter}
              </button>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="game-container">
      {['input', 'playing', 'won', 'lost'].includes(gameState) && renderTitle()}
      {isOnline && gameState !== 'landing' && renderScoreboard()}

      {gameState === 'landing' && (
        <div className="landing-section">
          <h1 className="game-main-title">TOLLYWOOD</h1>
          <div className="mode-selection">
            <button className="primary-btn offline-btn" onClick={() => { setIsOnline(false); setGameState('input'); }}>
              Play Offline 🏠
            </button>
            <button className="primary-btn online-btn" onClick={() => setGameState('online-menu')}>
              Play Online 🌐
            </button>
          </div>
        </div>
      )}

      {gameState === 'online-menu' && (
        <div className="online-menu-section">
          <h2>Online Multiplayer</h2>
          <div className="online-options">
            <button className="primary-btn" onClick={createRoom}>Create Game Room</button>
            <button className="secondary-btn" onClick={() => setGameState('landing')}>Back to Menu</button>
          </div>
        </div>
      )}

      {gameState === 'lobby' && (
        <div className="lobby-section">
          <h2>Game Lobby</h2>
          
          <div className="player-setup">
            <label>Your Name:</label>
            <input 
              type="text" 
              value={playerName} 
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter name..."
            />
          </div>

          <div className="room-info">
            <p>Room ID: <strong>{roomId}</strong></p>
            <button className="copy-btn" onClick={copyRoomLink}>Copy Invite Link 🔗</button>
          </div>

          {isHost && (
            <div className="game-config">
              <label>Points to Win:</label>
              <input 
                type="number" 
                min="1" 
                max="50" 
                value={targetPoints} 
                onChange={(e) => setTargetPoints(parseInt(e.target.value) || 1)}
              />
            </div>
          )}

          <div className="players-list">
            <h3>Players ({players.length})</h3>
            <ul>
              {players.map(p => (
                <li key={p.id}>
                  {p.name} {p.isHost ? '(Host)' : ''} {p.id === peerRef.current?.id ? '(You)' : ''}
                  <span className="player-score">Score: {p.score}</span>
                </li>
              ))}
            </ul>
          </div>

          {isHost ? (
            <div className="host-controls">
              <button 
                className="primary-btn" 
                onClick={startGameMatch}
                disabled={players.length < 2}
              >
                Start Match
              </button>
              {players.length < 2 && <p className="hint">Wait for at least one more player...</p>}
            </div>
          ) : (
            <p className="waiting-msg">Waiting for host to start the game...</p>
          )}
          
          <button className="secondary-btn" onClick={() => window.location.href = window.location.origin + window.location.pathname}>
            Leave Room
          </button>
        </div>
      )}

      {gameState === 'input' && (
        <div className="input-phase-container">
          {(() => {
            const myId = peerRef.current?.id || "";
            const isMyTurn = !isOnline || currentTurnId === myId;
            console.log('Input Phase Render:', { myId, currentTurnId, isMyTurn, isOnline });
            
            if (isMyTurn) {
              return (
                <form className="input-section" onSubmit={handleStartGame}>
                  <h2>Pick a Word!</h2>
                  <p className="hint">It's your turn to set the movie.</p>
                  
                  <div className="input-group">
                    <label>Game Word (Tries)</label>
                    <input
                      type="text"
                      placeholder="e.g. TOLLYWOOD"
                      value={gameWordInput}
                      onChange={(e) => setGameWordInput(e.target.value)}
                      autoFocus
                    />
                    <small>Leave blank for "TOLLYWOOD" (9 tries)</small>
                  </div>

                  <div className="input-group">
                    <label>Movie to Guess</label>
                    <input
                      type="password"
                      placeholder="e.g. Baahubali"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      required
                    />
                  </div>

                  <button type="submit" className="primary-btn">Start Round</button>
                </form>
              );
            } else {
              return (
                <div className="waiting-screen card-style">
                  <h2>Setting Phase</h2>
                  <p>Waiting for <strong>{players.find(p => p.id === currentTurnId)?.name || 'the setter'}</strong> to pick a movie...</p>
                  <div className="loader"></div>
                </div>
              );
            }
          })()}
        </div>
      )}

      {(gameState === 'playing' || gameState === 'won' || gameState === 'lost') && (
        <>
          {renderMovieBlanks()}
          
          {gameState === 'playing' && (
            <>
              {(!isOnline || currentTurnId !== peerRef.current?.id) ? (
                renderKeyboard()
              ) : (
                <div className="setter-view card-style">
                  <h3>They are guessing!</h3>
                  <p>The movie is: <strong>{movieName}</strong></p>
                  <p>Guessed so far: {Array.from(guessedLetters).join(', ') || 'None'}</p>
                </div>
              )}
              <div className="online-status-bar">
                Current Setter: {players.find(p => p.id === currentTurnId)?.name}
              </div>
            </>
          )}

          {gameState === 'won' && (
            <div className="status-message win">
              <h2>You Won! 🎉</h2>
              <p>The movie was: <strong>{movieName}</strong></p>
              {(!isOnline || isHost) && <button className="primary-btn" onClick={resetGame}>Play Again</button>}
            </div>
          )}

          {gameState === 'lost' && (
            <div className="status-message loss">
              <h2>Game Over! 💀</h2>
              <p>The movie was: <strong>{movieName}</strong></p>
              {(!isOnline || isHost) && <button className="primary-btn" onClick={resetGame}>Try Again</button>}
            </div>
          )}
        </>
      )}

      {gameState === 'match-over' && (
        <div className="match-over-section card-style">
          <h1 className="congrats">MATCH OVER!</h1>
          <div className="winner-announcement">
            <span className="trophy">🏆</span>
            <h2>{winnerName} Wins the Match!</h2>
          </div>
          <div className="final-scores">
            {players.map(p => (
              <div key={p.id} className="final-score-item">
                {p.name}: {p.score} pts
              </div>
            ))}
          </div>
          {isHost && (
            <button className="primary-btn" onClick={resetGame}>Back to Lobby</button>
          )}
        </div>
      )}
    </div>
  )
}

export default App
