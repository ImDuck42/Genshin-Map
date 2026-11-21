// Written by Gemini 4 Hydrogen Web

import { MapLoader } from './mapLoader.js'

export class Spot {
 constructor(spotEntry, imageLocation) {
  this.id   = Number(spotEntry.id)
  this.mapId = Number(spotEntry.mapId)
  this.coords = { x: Number(spotEntry.coords.x), y: Number(spotEntry.coords.y) }
  this.image = imageLocation
 }

 checkGuess(x, y) {
  const distance = Math.hypot(this.coords.x - Number(x), this.coords.y - Number(y))
  return {
   exact:       distance === 0,
   distance:      distance,
   correctCoordinates: { ...this.coords },
  }
 }
}

export class SpotLoader {
 constructor(indexLocationPath, minimumCropSize = 160, maximumCropSize = 384, queueCapacity = 2) {
  this.indexLocationPath = indexLocationPath
  this.minimumCropSize  = minimumCropSize
  this.maximumCropSize  = maximumCropSize
  this.queueCapacity   = queueCapacity
  this.loadedStatus   = false
  this.isFillingQueue  = false
  this.nextSpotId    = 1
  this.mapEntries    = []
  this.spotQueue     = []
  this.spotsCollection  = []
  this.spotsById     = new Map()
  this.tileImageCache  = new Map()
  this.offscreenCanvas  = document.createElement('canvas')
  this.renderingContext = this.offscreenCanvas.getContext('2d', { willReadFrequently: true })
 }

 get isLoaded()  { return this.loadedStatus }
 get allSpots()  { return this.spotsCollection }
 get totalSpots() { return this.spotsCollection.length }

 getSpotById(targetId)    { return this.spotsById.get(Number(targetId)) ?? null }
 getSpotsByMapId(targetMapId) { return this.spotsCollection.filter((spot) => spot.mapId === Number(targetMapId)) }

 getRandomSpot(targetMapId = null) {
  const queueIndex = targetMapId === null
   ? (this.spotQueue.length > 0 ? 0 : -1)
   : this.spotQueue.findIndex((spot) => spot.mapId === Number(targetMapId))

  if (queueIndex !== -1) {
   const [readySpot] = this.spotQueue.splice(queueIndex, 1)
   this.fillQueue()
   return readySpot
  }

  this.fillQueue(targetMapId)

  const fallbackPool = targetMapId === null ? this.spotsCollection : this.getSpotsByMapId(targetMapId)
  return fallbackPool.length === 0 ? null : fallbackPool[Math.floor(Math.random() * fallbackPool.length)]
 }

 randomCropDimension(maximumMapDimension) {
  const randomSize = Math.floor(this.minimumCropSize + Math.random() * (this.maximumCropSize - this.minimumCropSize + 1))
  return Math.min(maximumMapDimension, randomSize)
 }

 loadTileImage(tileLocation) {
  let cachedPromise = this.tileImageCache.get(tileLocation)
  if (cachedPromise) return cachedPromise

  cachedPromise = new Promise((resolve) => {
   const imageElement    = new Image()
   imageElement.crossOrigin = 'anonymous'
   imageElement.onload   = () => resolve(imageElement)
   imageElement.onerror   = () => resolve(null)
   imageElement.src     = tileLocation
  })

  this.tileImageCache.set(tileLocation, cachedPromise)
  return cachedPromise
 }

 analyzeMapLayout(targetMap) {
  const validTiles = []
  let minimumColumn = Infinity, maximumColumn = -Infinity, minimumRow = Infinity, maximumRow = -Infinity

  for (let row = 1; row <= targetMap.rows; row += 1) {
   for (let column = 1; column <= targetMap.columns; column += 1) {
    if (!targetMap.isTileOmitted(column, row)) {
     validTiles.push({ column, row })
     if (column < minimumColumn) minimumColumn = column
     if (column > maximumColumn) maximumColumn = column
     if (row  < minimumRow)  minimumRow  = row
     if (row  > maximumRow)  maximumRow  = row
    }
   }
  }

  const landBounds = validTiles.length === 0
   ? { minimumX: 0, minimumY: 0, width: targetMap.width, height: targetMap.height }
   : {
     minimumX: (minimumColumn - 1) * targetMap.tileSize,
     minimumY: (minimumRow  - 1) * targetMap.tileSize,
     width:  (maximumColumn - minimumColumn + 1) * targetMap.tileSize,
     height:  (maximumRow  - minimumRow  + 1) * targetMap.tileSize,
    }

  return { map: targetMap, validTiles, landBounds }
 }

 async createRandomSpot(targetMapId = null) {
  const availableMaps = targetMapId === null
   ? this.mapEntries
   : this.mapEntries.filter((entry) => entry.map.identifier === Number(targetMapId))

  if (availableMaps.length === 0) return null

  const { map, validTiles, landBounds } = availableMaps[Math.floor(Math.random() * availableMaps.length)]
  const tileSize            = map.tileSize
  const cropWidth            = this.randomCropDimension(map.width)
  const cropHeight           = this.randomCropDimension(map.height)

  this.offscreenCanvas.width = cropWidth
  this.offscreenCanvas.height = cropHeight

  for (let attempt = 0; attempt < 60; attempt += 1) {
   const randomTile = validTiles[Math.floor(Math.random() * validTiles.length)]
   const cropLeft  = Math.max(0, Math.min(map.width - cropWidth, Math.round((randomTile.column - 1 + Math.random()) * tileSize - cropWidth * 0.5)))
   const cropTop  = Math.max(0, Math.min(map.height - cropHeight, Math.round((randomTile.row  - 1 + Math.random()) * tileSize - cropHeight * 0.5)))

   const firstColumn = Math.floor(cropLeft / tileSize) + 1
   const lastColumn = Math.floor((cropLeft + cropWidth - 1) / tileSize) + 1
   const firstRow  = Math.floor(cropTop / tileSize) + 1
   const lastRow   = Math.floor((cropTop + cropHeight - 1) / tileSize) + 1

   let hasMissingTile = false
   const tileRequests = []

   for (let row = firstRow; row <= lastRow && !hasMissingTile; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
     if (column < 1 || column > map.columns || row < 1 || row > map.rows || map.isTileOmitted(column, row)) {
      hasMissingTile = true
      break
     }
     tileRequests.push(this.loadTileImage(map.getTileLocation(column, row)).then((imageElement) => ({ column, row, imageElement })))
    }
   }

   if (hasMissingTile) continue

   const loadedTiles = await Promise.all(tileRequests)
   if (loadedTiles.some((tile) => !tile.imageElement)) continue

   this.renderingContext.clearRect(0, 0, cropWidth, cropHeight)
   for (const tile of loadedTiles) {
    this.renderingContext.drawImage(tile.imageElement, (tile.column - 1) * tileSize - cropLeft, (tile.row - 1) * tileSize - cropTop)
   }

   const pixelData   = this.renderingContext.getImageData(0, 0, cropWidth, cropHeight).data
   let hasTransparency = false

   for (let alphaIndex = 3; alphaIndex < pixelData.length; alphaIndex += 4) {
    if (pixelData[alphaIndex] < 255) {
     hasTransparency = true
     break
    }
   }

   if (hasTransparency) continue

   const generatedSpot = new Spot({
    id:   this.nextSpotId++,
    mapId: map.identifier,
    coords: {
     x: cropLeft + cropWidth * 0.5 - landBounds.minimumX,
     y: cropTop + cropHeight * 0.5 - landBounds.minimumY,
    },
   }, this.offscreenCanvas.toDataURL('image/png'))

   this.spotsCollection.push(generatedSpot)
   this.spotsById.set(generatedSpot.id, generatedSpot)
   return generatedSpot
  }

  return null
 }

 async fillQueue(preferredMapId = null) {
  if (this.isFillingQueue) return
  this.isFillingQueue = true

  try {
   while (this.spotQueue.length < this.queueCapacity) {
    const generatedSpot = await this.createRandomSpot(preferredMapId)
    if (!generatedSpot) break
    this.spotQueue.push(generatedSpot)
    preferredMapId = null
   }
  } finally {
   this.isFillingQueue = false
  }
 }

 async load() {
  const mapsIndexLocation = this.indexLocationPath
   ? new URL('../genshin_maps/index.json', new URL(this.indexLocationPath, window.location.href)).href
   : './assets/genshin_maps/index.json'

  const mapLoader = await new MapLoader(mapsIndexLocation).load()
  this.mapEntries = mapLoader.allMaps.map((targetMap) => this.analyzeMapLayout(targetMap)).filter((entry) => entry.validTiles.length > 0)

  const initialSpot = await this.createRandomSpot()
  if (initialSpot) this.spotQueue.push(initialSpot)

  this.fillQueue()
  this.loadedStatus = true
  return this
 }
}

export default SpotLoader