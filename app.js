import { MapLoader }     from './libraries/mapLoader.js'
import { SpotLoader }    from './libraries/dummy.js' // spotLoader
import { MapRenderer }   from './libraries/mapRenderer.js'
import { evaluateGuess } from './libraries/guessScoring.js'

const mapSelectorElement = document.getElementById('mapSelector')
const displayDistance    = document.getElementById('displayDistance')
const displayPoints      = document.getElementById('displayPoints')
const guessButton        = document.getElementById('btnGuess')
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

let activeMap              = null
let currentSpot            = null
let playerGuessCoordinates = null
let solutionCoordinates    = null
let totalScore             = 0
let pointerDownOrigin      = null

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

  if (!playerGuessCoordinates || !activeMap) return
  if (solutionCoordinates && activeMap.identifier !== currentSpot?.mapId) return

  const { renderingContext, pixelRatio } = mapRendererInstance
  const guessPoint                       = mapRendererInstance.mapToCanvasCoordinates(playerGuessCoordinates.x, playerGuessCoordinates.y)

  if (solutionCoordinates) {
    const answerPoint = mapRendererInstance.mapToCanvasCoordinates(solutionCoordinates.x, solutionCoordinates.y)
    drawConnectingLine(renderingContext, guessPoint, answerPoint, '#f0c674', 3, pixelRatio)
    drawMarker(renderingContext, answerPoint, '#3fb950', '#ffffff', 6, pixelRatio)
  }

  drawMarker(renderingContext, guessPoint, '#f85149', '#ffffff', 6, pixelRatio)
}

function isValidLandmassClick(clickedLandCoordinates, screenX, screenY) {
  if (!clickedLandCoordinates || !activeMap) return false

  const bounds = mapRendererInstance.landBounds
  if (
    clickedLandCoordinates.x < 0            || clickedLandCoordinates.y < 0 ||
    clickedLandCoordinates.x > bounds.width || clickedLandCoordinates.y > bounds.height
  ) {
    return false
  }

  const column = Math.floor(clickedLandCoordinates.rawX / activeMap.tileSize) + 1
  const row    = Math.floor(clickedLandCoordinates.rawY / activeMap.tileSize) + 1
  if (activeMap.isTileOmitted(column, row)) return false

  const canvasBoundingBox = canvasViewport.getBoundingClientRect()
  const canvasPixelX      = Math.floor((screenX - canvasBoundingBox.left) * mapRendererInstance.pixelRatio)
  const canvasPixelY      = Math.floor((screenY - canvasBoundingBox.top)  * mapRendererInstance.pixelRatio)

  if (canvasPixelX < 0 || canvasPixelY < 0 || canvasPixelX >= canvasViewport.width || canvasPixelY >= canvasViewport.height) {
    return false
  }

  try {
    return mapRendererInstance.renderingContext.getImageData(canvasPixelX, canvasPixelY, 1, 1).data[3] > 0
  } catch {
    return true
  }
}

function selectMap(targetMap) {
  if (!targetMap) return

  activeMap                = targetMap
  mapSelectorElement.value = targetMap.identifier

  if (!solutionCoordinates) {
    playerGuessCoordinates = null
    guessButton.disabled   = true
  }

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
  playerGuessCoordinates      = null
  solutionCoordinates         = null
  spotImageElement.src        = randomSpot.image
  spotViewerImage.src         = randomSpot.image
  spotPanel.hidden            = false
  guessButton.disabled        = true
  guessButton.textContent     = 'Guess'
  displayDistance.textContent = '0'
  displayPoints.textContent   = `${totalScore}`

  mapRendererInstance.requestRender()
}

function handleGuessSubmission() {
  if (solutionCoordinates) {
    selectRandomSpot()
    return
  }

  if (!currentSpot || !playerGuessCoordinates || !activeMap) return

  const answerCoordinates = currentSpot.coords
  const answerMap         = mapLoaderInstance.getMapByIdentifier(currentSpot.mapId)
  const isDifferentMap    = Boolean(answerMap && answerMap.identifier !== activeMap.identifier)
  const previousBounds    = mapRendererInstance.landBounds

  if (isDifferentMap) {
    activeMap                = answerMap
    mapSelectorElement.value = answerMap.identifier
    mapRendererInstance.displayMap(answerMap)

    const newBounds        = mapRendererInstance.landBounds
    playerGuessCoordinates = {
      x: (playerGuessCoordinates.x * newBounds.width)  / previousBounds.width,
      y: (playerGuessCoordinates.y * newBounds.height) / previousBounds.height,
    }
  }

  const evaluation            = evaluateGuess(answerCoordinates, playerGuessCoordinates, mapRendererInstance.landBounds)
  const roundScore            = isDifferentMap ? 0 : evaluation.score

  solutionCoordinates         = answerCoordinates
  totalScore                 += roundScore
  guessButton.textContent     = 'Next'
  guessButton.disabled        = false
  displayDistance.textContent = `${evaluation.distance.toFixed(1)} px`
  displayPoints.textContent   = `${totalScore}`

  mapRendererInstance.requestRender()
}

mapSelectorElement.innerHTML = mapLoaderInstance.allMaps
  .map((mapEntry) => `<option value="${mapEntry.identifier}">${mapEntry.name}</option>`)
  .join('')

mapSelectorElement.addEventListener('change', (event) => {
  selectMap(mapLoaderInstance.getMapByIdentifier(event.target.value))
})

canvasViewport.addEventListener('pointerdown', (event) => {
  pointerDownOrigin = { x: event.clientX, y: event.clientY }
})

canvasViewport.addEventListener('pointerup', (event) => {
  if (!pointerDownOrigin || !currentSpot || solutionCoordinates || !activeMap) return

  const deltaX      = event.clientX - pointerDownOrigin.x
  const deltaY      = event.clientY - pointerDownOrigin.y
  pointerDownOrigin = null

  if ((deltaX * deltaX + deltaY * deltaY) > 25) return

  const clickedCoordinates = mapRendererInstance.screenToMapCoordinates(event.clientX, event.clientY, true)
  if (!isValidLandmassClick(clickedCoordinates, event.clientX, event.clientY)) {
    playerGuessCoordinates = null
    guessButton.disabled   = true
    mapRendererInstance.requestRender()
    return
  }

  playerGuessCoordinates = clickedCoordinates
  guessButton.disabled   = false
  mapRendererInstance.requestRender()
})

guessButton.addEventListener('click', handleGuessSubmission)

spotImageElement.addEventListener('click', () => {
  spotViewer.hidden = false
})

spotViewer.addEventListener('click', (event) => {
  if (event.target === spotViewer) spotViewer.hidden = true
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') spotViewer.hidden = true
})

if (mapLoaderInstance.defaultMap) {
  selectMap(mapLoaderInstance.defaultMap)
  selectRandomSpot()
}