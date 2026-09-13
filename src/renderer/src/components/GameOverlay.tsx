import { useState, useEffect, useRef } from 'react'
import './GameOverlay.css'

interface Props {
  visible: boolean
}

type GameType = 'snake' | 'flappy' | '2048' | 'tetris' | 'breakout' | 'simon' | 'pong' | 'memory'

// Snake Game
function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameOver, setGameOver] = useState(false)
  const [score, setScore] = useState(0)
  const gameStateRef = useRef({
    snake: [{ x: 10, y: 10 }],
    food: { x: 15, y: 15 },
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    score: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const gridSize = 20
    const tileCount = canvas.width / gridSize

    const drawGame = () => {
      const state = gameStateRef.current
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw snake
      ctx.fillStyle = '#00d4ff'
      state.snake.forEach((segment) => {
        ctx.fillRect(segment.x * gridSize + 1, segment.y * gridSize + 1, gridSize - 2, gridSize - 2)
      })

      // Draw food
      ctx.fillStyle = '#ff006e'
      ctx.fillRect(state.food.x * gridSize + 1, state.food.y * gridSize + 1, gridSize - 2, gridSize - 2)

      // Draw grid
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 0.5
      for (let i = 0; i <= tileCount; i++) {
        ctx.beginPath()
        ctx.moveTo(i * gridSize, 0)
        ctx.lineTo(i * gridSize, canvas.height)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(0, i * gridSize)
        ctx.lineTo(canvas.width, i * gridSize)
        ctx.stroke()
      }
    }

    const updateGame = () => {
      const state = gameStateRef.current
      state.direction = state.nextDirection

      const head = { ...state.snake[0] }
      head.x += state.direction.x
      head.y += state.direction.y

      // Check collision with walls
      if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
        setGameOver(true)
        return
      }

      // Check collision with self
      if (state.snake.some((segment) => segment.x === head.x && segment.y === head.y)) {
        setGameOver(true)
        return
      }

      state.snake.unshift(head)

      // Check food collision
      if (head.x === state.food.x && head.y === state.food.y) {
        state.score += 10
        setScore(state.score)
        state.food = {
          x: Math.floor(Math.random() * tileCount),
          y: Math.floor(Math.random() * tileCount),
        }
      } else {
        state.snake.pop()
      }
    }

    const gameLoop = setInterval(() => {
      if (!gameOver) {
        updateGame()
        drawGame()
      }
    }, 100)

    const handleKeyPress = (e: KeyboardEvent) => {
      const state = gameStateRef.current
      switch (e.key.toLowerCase()) {
        case 'arrowup':
        case 'w':
          if (state.direction.y === 0) state.nextDirection = { x: 0, y: -1 }
          break
        case 'arrowdown':
        case 's':
          if (state.direction.y === 0) state.nextDirection = { x: 0, y: 1 }
          break
        case 'arrowleft':
        case 'a':
          if (state.direction.x === 0) state.nextDirection = { x: -1, y: 0 }
          break
        case 'arrowright':
        case 'd':
          if (state.direction.x === 0) state.nextDirection = { x: 1, y: 0 }
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    drawGame()

    return () => {
      clearInterval(gameLoop)
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [gameOver])

  return (
    <div className="game-container">
      <div className="game-header">
        <h3>Snake Game</h3>
        <p className="game-score">Score: {score}</p>
      </div>
      <canvas ref={canvasRef} width={400} height={400} className="game-canvas" />
      {gameOver && (
        <div className="game-over">
          <p>Game Over! Final Score: {score}</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Play Again
          </button>
        </div>
      )}
      <p className="game-controls">Arrow keys or WASD to move</p>
    </div>
  )
}

// Flappy Bird Game
function FlappyBirdGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameOver, setGameOver] = useState(false)
  const [score, setScore] = useState(0)
  const gameStateRef = useRef({
    bird: { y: 150, vy: 0 },
    pipes: [] as Array<{ x: number; height: number }>,
    score: 0,
    gameRunning: true,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pipeGap = 120
    const pipeWidth = 60
    const birdRadius = 10

    const generatePipe = (x: number) => ({
      x,
      height: Math.random() * (canvas.height - pipeGap - 60) + 30,
    })

    gameStateRef.current.pipes = [
      generatePipe(canvas.width),
      generatePipe(canvas.width + 300),
      generatePipe(canvas.width + 600),
    ]

    const drawGame = () => {
      const state = gameStateRef.current
      ctx.fillStyle = '#87CEEB'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw pipes
      ctx.fillStyle = '#228B22'
      state.pipes.forEach((pipe) => {
        ctx.fillRect(pipe.x, 0, pipeWidth, pipe.height)
        ctx.fillRect(pipe.x, pipe.height + pipeGap, pipeWidth, canvas.height - pipe.height - pipeGap)
      })

      // Draw bird
      ctx.fillStyle = '#FFD700'
      ctx.beginPath()
      ctx.arc(50, state.bird.y, birdRadius, 0, Math.PI * 2)
      ctx.fill()

      // Draw ground
      ctx.fillStyle = '#8B7355'
      ctx.fillRect(0, canvas.height - 30, canvas.width, 30)
    }

    const updateGame = () => {
      const state = gameStateRef.current
      if (!state.gameRunning) return

      state.bird.vy += 0.5
      state.bird.y += state.bird.vy

      // Collision with ground
      if (state.bird.y + birdRadius > canvas.height - 30) {
        state.gameRunning = false
        setGameOver(true)
        return
      }

      // Move pipes
      state.pipes = state.pipes.map((pipe) => ({
        ...pipe,
        x: pipe.x - 5,
      }))

      // Remove off-screen pipes and add new ones
      if (state.pipes[0].x + pipeWidth < 0) {
        state.pipes.shift()
        state.pipes.push(generatePipe(canvas.width))
        state.score += 1
        setScore(state.score)
      }

      // Collision with pipes
      state.pipes.forEach((pipe) => {
        if (
          50 + birdRadius > pipe.x &&
          50 - birdRadius < pipe.x + pipeWidth &&
          (state.bird.y - birdRadius < pipe.height || state.bird.y + birdRadius > pipe.height + pipeGap)
        ) {
          state.gameRunning = false
          setGameOver(true)
        }
      })
    }

    const gameLoop = setInterval(() => {
      updateGame()
      drawGame()
    }, 20)

    const handleClick = () => {
      gameStateRef.current.bird.vy = -10
    }

    canvas.addEventListener('click', handleClick)
    drawGame()

    return () => {
      clearInterval(gameLoop)
      canvas.removeEventListener('click', handleClick)
    }
  }, [gameOver])

  return (
    <div className="game-container">
      <div className="game-header">
        <h3>Flappy Bird</h3>
        <p className="game-score">Score: {score}</p>
      </div>
      <canvas ref={canvasRef} width={400} height={400} className="game-canvas" />
      {gameOver && (
        <div className="game-over">
          <p>Game Over! Final Score: {score}</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Play Again
          </button>
        </div>
      )}
      <p className="game-controls">Click to flap</p>
    </div>
  )
}

// 2048 Game
function Game2048() {
  const [board, setBoard] = useState<number[][]>([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ])
  const [score, setScore] = useState(0)

  const initBoard = () => {
    const newBoard = board.map((row) => [...row])
    const emptySpaces = newBoard
      .flatMap((row, r) => row.map((val, c) => (val === 0 ? { r, c } : null)))
      .filter(Boolean) as Array<{ r: number; c: number }>

    for (let i = 0; i < 2; i++) {
      if (emptySpaces.length === 0) break
      const { r, c } = emptySpaces[Math.floor(Math.random() * emptySpaces.length)]
      newBoard[r][c] = Math.random() < 0.9 ? 2 : 4
    }
    return newBoard
  }

  useEffect(() => {
    setBoard(initBoard())
  }, [])

  const move = (direction: 'left' | 'right' | 'up' | 'down') => {
    let newBoard = board.map((row) => [...row])
    let moved = false
    let newScore = score

    const slide = (row: number[]) => {
      const filtered = row.filter((val) => val !== 0)
      for (let i = 0; i < filtered.length - 1; i++) {
        if (filtered[i] === filtered[i + 1]) {
          filtered[i] *= 2
          newScore += filtered[i]
          filtered.splice(i + 1, 1)
        }
      }
      while (filtered.length < 4) filtered.push(0)
      return filtered
    }

    if (direction === 'left') {
      newBoard = newBoard.map((row) => {
        const newRow = slide([...row])
        if (JSON.stringify(newRow) !== JSON.stringify(row)) moved = true
        return newRow
      })
    } else if (direction === 'right') {
      newBoard = newBoard.map((row) => {
        const newRow = slide([...row].reverse()).reverse()
        if (JSON.stringify(newRow) !== JSON.stringify(row)) moved = true
        return newRow
      })
    } else if (direction === 'up') {
      for (let c = 0; c < 4; c++) {
        const column = [newBoard[0][c], newBoard[1][c], newBoard[2][c], newBoard[3][c]]
        const newCol = slide([...column])
        if (JSON.stringify(newCol) !== JSON.stringify(column)) moved = true
        for (let r = 0; r < 4; r++) newBoard[r][c] = newCol[r]
      }
    } else if (direction === 'down') {
      for (let c = 0; c < 4; c++) {
        const column = [newBoard[0][c], newBoard[1][c], newBoard[2][c], newBoard[3][c]]
        const newCol = slide([...column].reverse()).reverse()
        if (JSON.stringify(newCol) !== JSON.stringify(column)) moved = true
        for (let r = 0; r < 4; r++) newBoard[r][c] = newCol[r]
      }
    }

    if (moved) {
      const emptySpaces = newBoard
        .flatMap((row, r) => row.map((val, c) => (val === 0 ? { r, c } : null)))
        .filter(Boolean) as Array<{ r: number; c: number }>

      if (emptySpaces.length > 0) {
        const { r, c } = emptySpaces[Math.floor(Math.random() * emptySpaces.length)]
        newBoard[r][c] = Math.random() < 0.9 ? 2 : 4
      }

      setBoard(newBoard)
      setScore(newScore)
    }
  }

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const directionMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        }
        move(directionMap[e.key])
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [board, score])

  return (
    <div className="game-container">
      <div className="game-header">
        <h3>2048</h3>
        <p className="game-score">Score: {score}</p>
      </div>
      <div className="board-2048">
        {board.map((row, r) =>
          row.map((val, c) => (
            <div key={`${r}-${c}`} className={`tile tile-${val}`}>
              {val !== 0 && val}
            </div>
          ))
        )}
      </div>
      <p className="game-controls">Arrow keys to move</p>
    </div>
  )
}

// Breakout Game
function BreakoutGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameOver, setGameOver] = useState(false)
  const [score, setScore] = useState(0)
  const gameStateRef = useRef({
    paddle: { x: 175, y: 370, width: 50, height: 10 },
    ball: { x: 200, y: 350, radius: 5, vx: 3, vy: -3 },
    bricks: [] as Array<{ x: number; y: number; width: number; height: number }>,
    score: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Initialize bricks
    const bricks = []
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        bricks.push({
          x: i * 65 + 5,
          y: j * 20 + 30,
          width: 60,
          height: 15,
        })
      }
    }
    gameStateRef.current.bricks = bricks

    let mouseX = 200

    const drawGame = () => {
      const state = gameStateRef.current
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw paddle
      ctx.fillStyle = '#00d4ff'
      ctx.fillRect(state.paddle.x, state.paddle.y, state.paddle.width, state.paddle.height)

      // Draw ball
      ctx.fillStyle = '#ff006e'
      ctx.beginPath()
      ctx.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2)
      ctx.fill()

      // Draw bricks
      ctx.fillStyle = '#00ff88'
      state.bricks.forEach((brick) => {
        ctx.fillRect(brick.x, brick.y, brick.width, brick.height)
      })
    }

    const updateGame = () => {
      const state = gameStateRef.current

      state.ball.x += state.ball.vx
      state.ball.y += state.ball.vy

      // Bounce off walls
      if (state.ball.x - state.ball.radius < 0 || state.ball.x + state.ball.radius > canvas.width) {
        state.ball.vx *= -1
      }
      if (state.ball.y - state.ball.radius < 0) {
        state.ball.vy *= -1
      }

      // Ball out of bounds
      if (state.ball.y > canvas.height) {
        setGameOver(true)
        return
      }

      // Paddle collision
      if (
        state.ball.y + state.ball.radius > state.paddle.y &&
        state.ball.x > state.paddle.x &&
        state.ball.x < state.paddle.x + state.paddle.width
      ) {
        state.ball.vy *= -1
      }

      // Brick collision
      state.bricks = state.bricks.filter((brick) => {
        if (
          state.ball.x > brick.x &&
          state.ball.x < brick.x + brick.width &&
          state.ball.y > brick.y &&
          state.ball.y < brick.y + brick.height
        ) {
          state.ball.vy *= -1
          state.score += 10
          setScore(state.score)
          return false
        }
        return true
      })
    }

    const gameLoop = setInterval(() => {
      if (!gameOver) {
        updateGame()
        drawGame()

        // Update paddle position
        gameStateRef.current.paddle.x = Math.max(0, Math.min(canvas.width - 50, mouseX - 25))
      }
    }, 20)

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX - (canvas.getBoundingClientRect().left || 0)
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    drawGame()

    return () => {
      clearInterval(gameLoop)
      canvas.removeEventListener('mousemove', handleMouseMove)
    }
  }, [gameOver])

  return (
    <div className="game-container">
      <div className="game-header">
        <h3>Breakout</h3>
        <p className="game-score">Score: {score}</p>
      </div>
      <canvas ref={canvasRef} width={400} height={400} className="game-canvas" />
      {gameOver && (
        <div className="game-over">
          <p>Game Over! Final Score: {score}</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Play Again
          </button>
        </div>
      )}
      <p className="game-controls">Move mouse to control paddle</p>
    </div>
  )
}

// Simon Says Memory Game
function SimonGame() {
  const [sequence, setSequence] = useState<number[]>([])
  const [playerSequence, setPlayerSequence] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [gameRunning, setGameRunning] = useState(true)
  const colors = ['#ff006e', '#00d4ff', '#00ff88', '#ffd700']
  const [activeColor, setActiveColor] = useState<number | null>(null)

  const playSequence = async (seq: number[]) => {
    for (let i = 0; i < seq.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      setActiveColor(seq[i])
      await new Promise((resolve) => setTimeout(resolve, 300))
      setActiveColor(null)
    }
  }

  const handleColorClick = async (index: number) => {
    if (!gameRunning) return

    const newSequence = [...playerSequence, index]
    setPlayerSequence(newSequence)
    setActiveColor(index)

    setTimeout(() => setActiveColor(null), 200)

    if (newSequence[newSequence.length - 1] !== sequence[newSequence.length - 1]) {
      setGameRunning(false)
      return
    }

    if (newSequence.length === sequence.length) {
      const nextSequence = [...sequence, Math.floor(Math.random() * 4)]
      setSequence(nextSequence)
      setPlayerSequence([])
      setScore(sequence.length)

      setTimeout(() => {
        playSequence(nextSequence)
      }, 1000)
    }
  }

  useEffect(() => {
    if (sequence.length === 0 && gameRunning) {
      const firstSequence = [Math.floor(Math.random() * 4)]
      setSequence(firstSequence)
      playSequence(firstSequence)
    }
  }, [])

  return (
    <div className="game-container">
      <div className="game-header">
        <h3>Simon Says</h3>
        <p className="game-score">Level: {score + 1}</p>
      </div>
      <div className="simon-board">
        {colors.map((color, index) => (
          <button
            key={index}
            className={`simon-button ${activeColor === index ? 'active' : ''}`}
            style={{
              backgroundColor: color,
              opacity: activeColor === index ? 1 : 0.6,
            }}
            onClick={() => handleColorClick(index)}
            disabled={!gameRunning}
          />
        ))}
      </div>
      {!gameRunning && (
        <div className="game-over">
          <p>Game Over! Level: {score + 1}</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Try Again
          </button>
        </div>
      )}
      <p className="game-controls">Click the colors in order</p>
    </div>
  )
}

// Memory Match Game
function MemoryGame() {
  const [cards, setCards] = useState<Array<{ id: number; value: number; flipped: boolean; matched: boolean }>>([])
  const [score, setScore] = useState(0)
  const [moves, setMoves] = useState(0)

  useEffect(() => {
    const values = [...Array(8).keys()].flatMap((i) => [i, i])
    const shuffled = values.sort(() => Math.random() - 0.5)
    setCards(
      shuffled.map((value, id) => ({
        id,
        value,
        flipped: false,
        matched: false,
      }))
    )
  }, [])

  const handleCardClick = (id: number) => {
    if (cards[id].flipped || cards[id].matched) return

    const newCards = [...cards]
    newCards[id].flipped = true
    setCards(newCards)

    const flipped = newCards.filter((c) => c.flipped && !c.matched)
    if (flipped.length === 2) {
      setMoves(moves + 1)

      if (flipped[0].value === flipped[1].value) {
        setTimeout(() => {
          const matched = newCards.map((c) => (c.value === flipped[0].value ? { ...c, matched: true, flipped: false } : c))
          setCards(matched)
          setScore(score + 1)
        }, 500)
      } else {
        setTimeout(() => {
          const unflipped = newCards.map((c) => (c.flipped ? { ...c, flipped: false } : c))
          setCards(unflipped)
        }, 1000)
      }
    }
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <h3>Memory Match</h3>
        <p className="game-score">Pairs: {score}/8</p>
      </div>
      <div className="memory-grid">
        {cards.map((card) => (
          <button
            key={card.id}
            className={`memory-card ${card.flipped || card.matched ? 'flipped' : ''}`}
            onClick={() => handleCardClick(card.id)}
            disabled={card.matched}
          >
            {(card.flipped || card.matched) && card.value}
          </button>
        ))}
      </div>
      <p className="game-controls">Moves: {moves}</p>
      {score === 8 && (
        <div className="game-over">
          <p>You Won! Moves: {moves}</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Play Again
          </button>
        </div>
      )}
    </div>
  )
}

// Main Game Overlay Component
export default function GameOverlay({ visible }: Props) {
  const [gameType, setGameType] = useState<GameType>('snake')
  const games: { id: GameType; name: string }[] = [
    { id: 'snake', name: 'Snake' },
    { id: 'flappy', name: 'Flappy Bird' },
    { id: '2048', name: '2048' },
    { id: 'breakout', name: 'Breakout' },
    { id: 'simon', name: 'Simon Says' },
    { id: 'memory', name: 'Memory' },
  ]

  if (!visible) return null

  return (
    <div className="game-overlay">
      <div className="game-overlay-content">
        <div className="game-selector">
          <h2>Generation in Progress...</h2>
          <p>Play while ORION creates your image!</p>

          <div className="game-tabs">
            {games.map((game) => (
              <button
                key={game.id}
                className={`game-tab ${gameType === game.id ? 'active' : ''}`}
                onClick={() => setGameType(game.id)}
              >
                {game.name}
              </button>
            ))}
          </div>
        </div>

        <div className="game-display">
          {gameType === 'snake' && <SnakeGame />}
          {gameType === 'flappy' && <FlappyBirdGame />}
          {gameType === '2048' && <Game2048 />}
          {gameType === 'breakout' && <BreakoutGame />}
          {gameType === 'simon' && <SimonGame />}
          {gameType === 'memory' && <MemoryGame />}
        </div>
      </div>
    </div>
  )
}
