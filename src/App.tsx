import { useState, useEffect } from 'react'
import './App.css'

type GameState = 'landing' | 'input' | 'playing' | 'won' | 'lost'

const DEFAULT_GAME_NAME = "TOLLYWOOD"
const QWERTY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"]
]
const ALL_LETTERS = QWERTY_ROWS.flat()

function App() {
  const [gameState, setGameState] = useState<GameState>('landing')
  const [movieName, setMovieName] = useState("")
  const [gameWord, setGameWord] = useState(DEFAULT_GAME_NAME)
  const [inputValue, setInputValue] = useState("")
  const [gameWordInput, setGameWordInput] = useState("")
  const [guessedLetters, setGuessedLetters] = useState<Set<string>>(new Set())
  const [wrongLetters, setWrongLetters] = useState<string[]>([])
  const [wrongGuesses, setWrongGuesses] = useState(0)
  const [showComingSoon, setShowComingSoon] = useState(false)

  const isGuessable = (char: string) => /[A-Z]/.test(char)

  const handleStartGame = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim()) {
      setMovieName(inputValue.trim().toUpperCase())
      const customWord = gameWordInput.trim().toUpperCase() || DEFAULT_GAME_NAME
      setGameWord(customWord)
      setGameState('playing')
      setInputValue("")
    }
  }

  const handleGuess = (letter: string) => {
    if (gameState !== 'playing' || guessedLetters.has(letter)) return

    const newGuessedLetters = new Set(guessedLetters)
    newGuessedLetters.add(letter)
    setGuessedLetters(newGuessedLetters)

    if (!movieName.includes(letter)) {
      setWrongLetters(prev => [...prev, letter])
      const newWrongGuesses = wrongGuesses + 1
      setWrongGuesses(newWrongGuesses)
      if (newWrongGuesses >= gameWord.length) {
        setGameState('lost')
      }
    }
  }

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
  }, [gameState, guessedLetters, movieName, wrongGuesses, gameWord])

  useEffect(() => {
    if (gameState === 'playing' && movieName) {
      const movieChars = movieName.split("")
      const allGuessed = movieChars.every(char => 
        !isGuessable(char) || guessedLetters.has(char)
      )
      if (allGuessed) {
        setGameState('won')
      }
    }
  }, [guessedLetters, movieName, gameState])

  const resetGame = () => {
    setGameState('input')
    setMovieName("")
    setInputValue("")
    // gameWordInput is NOT reset, so it stays the same
    setGuessedLetters(new Set())
    setWrongLetters([])
    setWrongGuesses(0)
  }

  const handleOnlineClick = () => {
    setShowComingSoon(true)
    setTimeout(() => setShowComingSoon(false), 2000)
  }

  const renderTitle = () => {
    // Show live input word if in setup, otherwise show the locked game word
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
      {gameState !== 'landing' && renderTitle()}

      {gameState === 'landing' && (
        <div className="landing-section">
          <h1 className="game-main-title">TOLLYWOOD</h1>
          <div className="mode-selection">
            <button className="primary-btn offline-btn" onClick={() => setGameState('input')}>
              Play Offline 🏠
            </button>
            <div className="online-wrapper">
              <button className="primary-btn online-btn" onClick={handleOnlineClick}>
                Play Online 🌐
              </button>
              {showComingSoon && <div className="coming-soon-badge">Coming Soon!</div>}
            </div>
          </div>
        </div>
      )}

      {gameState === 'input' && (
        <form className="input-section" onSubmit={handleStartGame}>
          <h2>Game Setup</h2>
          
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

          <button type="submit" className="primary-btn">Start Game</button>
        </form>
      )}

      {(gameState === 'playing' || gameState === 'won' || gameState === 'lost') && (
        <>
          {renderMovieBlanks()}
          
          {gameState === 'playing' && renderKeyboard()}

          {gameState === 'won' && (
            <div className="status-message win">
              <h2>You Won! 🎉</h2>
              <p>The movie was: <strong>{movieName}</strong></p>
              <button className="primary-btn" onClick={resetGame}>Play Again</button>
            </div>
          )}

          {gameState === 'lost' && (
            <div className="status-message loss">
              <h2>Game Over! 💀</h2>
              <p>The movie was: <strong>{movieName}</strong></p>
              <button className="primary-btn" onClick={resetGame}>Try Again</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default App
