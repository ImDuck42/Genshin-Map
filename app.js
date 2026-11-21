import { MapLoader }     from './libraries/mapLoader.js'
import { SpotLoader }    from './libraries/spotLoader.js'
import { MapRenderer }   from './libraries/mapRenderer.js'
import { evaluateGuess } from './libraries/guessScoring.js'

const mapSelectorElement = document.getElementById('mapSelector')
const displayDistance    = document.getElementById('displayDistance')
const displayPoints      = document.getElementById('displayPoints')
const btnGuess           = document.getElementById('btnGuess')
const canvasViewport     = document.getElementById('canvasViewport')
const spotPanel          = document.getElementById('spotPanel')
const spotImageElement   = document.getElementById('spotImage')
const spotViewer         = document.getElementById('spotViewer')
const spotViewerImage    = document.getElementById('spotViewerImage')

const mapLoaderInstance  = new MapLoader('./assets/genshin_maps/index.json')
const spotLoaderInstance = new SpotLoader('./assets/genshin_spots/index.json')

await Promise.all([
  mapLoaderInstance.load(),
  spotLoaderInstance.load(),
])

const mapRendererInstance = new MapRenderer('#canvasViewport')

let activeMap         = null
let currentSpot       = null
let playerGuessCoords = null
let solutionCoords    = null
let totalScore        = 0
let pointerDownOrigin = null

function drawMarker(context, coordinates, fillColor, strokeColor, radiusPixels, pixelRatio) {
  context.beginPath()
  context.arc(coordinates.x, coordinates.y, radiusPixels * pixelRatio, 0, Math.PI * 2)
  context.fillStyle   = fillColor
  context.strokeStyle = strokeColor
  context.lineWidth   = 2 * pixelRatio
  context.fill()
  context.stroke()
}

function drawConnectingLine(context, startCoordinates, endCoordinates, strokeColor, lineWidthPixels, pixelRatio) {
  context.beginPath()
  context.moveTo(startCoordinates.x, startCoordinates.y)
  context.lineTo(endCoordinates.x,   endCoordinates.y)
  context.strokeStyle = strokeColor
  context.lineWidth   = lineWidthPixels * pixelRatio
  context.stroke()
}

const originalRenderMethod = mapRendererInstance.render.bind(mapRendererInstance)
mapRendererInstance.render = () => {
  originalRenderMethod()

  if (!playerGuessCoords || !activeMap) return

  const context    = mapRendererInstance.renderingContext
  const pixelRatio = mapRendererInstance.pixelRatio
  const guessPoint = mapRendererInstance.mapToCanvasCoordinates(playerGuessCoords.x, playerGuessCoords.y)

  if (solutionCoords) {
    const answerPoint = mapRendererInstance.mapToCanvasCoordinates(solutionCoords.x, solutionCoords.y)
    drawConnectingLine(context, guessPoint, answerPoint, '#f0c674', 3, pixelRatio)
    drawMarker(context, answerPoint, '#3fb950', '#ffffff', 6, pixelRatio)
  }

  drawMarker(context, guessPoint, '#f85149', '#ffffff', 6, pixelRatio)
}

function isValidLandmassClick(clickedLandCoords, screenX, screenY) {
  if (!clickedLandCoords || !activeMap) return false

  const bounds = mapRendererInstance.landBounds
  if (
    clickedLandCoords.x < 0 || clickedLandCoords.y < 0 ||
    clickedLandCoords.x > bounds.width || clickedLandCoords.y > bounds.height
  ) {
    return false
  }

  const tileSize = activeMap.tileSize
  const column   = Math.floor(clickedLandCoords.rawX / tileSize) + 1
  const row      = Math.floor(clickedLandCoords.rawY / tileSize) + 1

  if (activeMap.isTileOmitted(column, row)) {
    return false
  }

  const canvasRect   = canvasViewport.getBoundingClientRect()
  const canvasPixelX = Math.floor((screenX - canvasRect.left) * mapRendererInstance.pixelRatio)
  const canvasPixelY = Math.floor((screenY - canvasRect.top)  * mapRendererInstance.pixelRatio)

  if (
    canvasPixelX < 0 || canvasPixelY < 0 ||
    canvasPixelX >= canvasViewport.width || canvasPixelY >= canvasViewport.height
  ) {
    return false
  }

  try {
    const pixelAlpha = mapRendererInstance.renderingContext.getImageData(canvasPixelX, canvasPixelY, 1, 1).data[3]
    return pixelAlpha > 0
  } catch {
    return true
  }
}

function selectMap(targetMap) {
  totalScore                  = 0
  activeMap                   = targetMap
  currentSpot                 = null
  playerGuessCoords           = null
  solutionCoords              = null
  spotPanel.hidden            = true
  btnGuess.disabled           = true
  btnGuess.textContent        = 'Guess'
  displayDistance.textContent = '0'
  displayPoints.textContent   = '0'
  mapSelectorElement.value    = targetMap.identifier

  spotImageElement.removeAttribute('src')
  mapRendererInstance.displayMap(targetMap)
}

function selectRandomSpot() {
  const randomSpot = spotLoaderInstance.getRandomSpot()
  if (!randomSpot) {
    spotImageElement.removeAttribute('src')
    spotPanel.hidden = true
    return
  }

  currentSpot                 = randomSpot
  playerGuessCoords           = null
  solutionCoords              = null
  spotImageElement.src        = randomSpot.image
  spotViewerImage.src         = randomSpot.image
  spotPanel.hidden            = false
  btnGuess.disabled           = true
  btnGuess.textContent        = 'Guess'
  displayDistance.textContent = '0'
  displayPoints.textContent   = `${totalScore}`

  mapRendererInstance.requestRender()
}

function handleGuessSubmission() {
  if (solutionCoords) {
    selectRandomSpot()
    return
  }

  const answerCoordinates = currentSpot?.coords ?? playerGuessCoords
  if (!answerCoordinates || !playerGuessCoords || !activeMap) return

  const answerMap      = currentSpot ? mapLoaderInstance.getMapByIdentifier(currentSpot.mapId) : activeMap
  const isDifferentMap = Boolean(answerMap && answerMap.identifier !== activeMap.identifier)
  const guessLocation  = playerGuessCoords
  const previousBounds = mapRendererInstance.landBounds

  if (isDifferentMap) {
    activeMap                = answerMap
    mapSelectorElement.value = answerMap.identifier
    mapRendererInstance.displayMap(answerMap)

    const newBounds   = mapRendererInstance.landBounds
    playerGuessCoords = {
      x: (guessLocation.x * newBounds.width)  / previousBounds.width,
      y: (guessLocation.y * newBounds.height) / previousBounds.height,
    }
  }

  const currentBounds         = mapRendererInstance.landBounds
  const evaluation            = evaluateGuess(answerCoordinates, playerGuessCoords, { width: currentBounds.width, height: currentBounds.height })
  const roundScore            = isDifferentMap ? 0 : evaluation.score

  solutionCoords              = answerCoordinates
  totalScore                 += roundScore
  btnGuess.textContent        = 'Next'
  btnGuess.disabled           = false
  displayDistance.textContent = `${(evaluation.distance ?? evaluation.normalizedDistance * 100).toFixed(1)} px`
  displayPoints.textContent   = `${totalScore}`

  mapRendererInstance.requestRender()
}

mapSelectorElement.innerHTML = mapLoaderInstance.allMaps
  .map((mapEntry) => `<option value="${mapEntry.identifier}">${mapEntry.name}</option>`)
  .join('')

mapSelectorElement.addEventListener('change', (event) => {
  selectMap(mapLoaderInstance.getMapByIdentifier(Number(event.target.value)))
  selectRandomSpot()
})

canvasViewport.addEventListener('pointerdown', (event) => {
  pointerDownOrigin = { x: event.clientX, y: event.clientY }
})

canvasViewport.addEventListener('pointerup', (event) => {
  if (!pointerDownOrigin || !currentSpot || solutionCoords || !activeMap) return

  const hasDragged = Math.hypot(event.clientX - pointerDownOrigin.x, event.clientY - pointerDownOrigin.y) > 5
  pointerDownOrigin = null

  if (hasDragged) return

  const clickedCoordinates = mapRendererInstance.screenToMapCoordinates(event.clientX, event.clientY, true)

  if (!isValidLandmassClick(clickedCoordinates, event.clientX, event.clientY)) {
    playerGuessCoords = null
    btnGuess.disabled = true
    mapRendererInstance.requestRender()
    return
  }

  playerGuessCoords = clickedCoordinates
  btnGuess.disabled = false
  mapRendererInstance.requestRender()
})

btnGuess.addEventListener('click', handleGuessSubmission)

spotImageElement.addEventListener('click', () => {
  spotViewer.hidden = false
})

spotViewer.addEventListener('click', (event) => {
  if (event.target === spotViewer) {
    spotViewer.hidden = true
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    spotViewer.hidden = true
  }
})

if (mapLoaderInstance.defaultMap) {
  selectMap(mapLoaderInstance.defaultMap)
  selectRandomSpot()
}