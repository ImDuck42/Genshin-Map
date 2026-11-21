export class MapRenderer {
  constructor(canvasTarget, initialMap = null) {
    this.canvasElement            = typeof canvasTarget === 'string' ? document.querySelector(canvasTarget) : canvasTarget
    this.renderingContext         = this.canvasElement.getContext('2d', { alpha: true })

    this.activeMap                = initialMap
    this.tileCache                = new Map()
    this.runtimeOmittedTiles      = new Set()
    this.cachedLandBounds         = null

    this.overviewCanvas           = null
    this.overviewContext          = null
    this.overviewScale            = 1

    this.scaleMultiplier          = 1
    this.minimumScale             = 0
    this.maximumScale             = Infinity
    this.positionHorizontal       = 0
    this.positionVertical         = 0
    this.isDragging               = false
    this.lastPointerHorizontal    = 0
    this.lastPointerVertical      = 0
    this.animationFrameIdentifier = null

    this.bindEventListeners()

    if (this.activeMap) {
      this.computeLandBounds()
      this.setupOverviewCanvas()
      this.fitToScreen()
      this.requestRender()
    }
  }

  get currentMap()        { return this.activeMap }
  get zoomLevel()         { return this.scaleMultiplier }
  get pixelRatio()        { return window.devicePixelRatio || 1 }
  get canvasWidth()       { return this.canvasElement.width }
  get canvasHeight()      { return this.canvasElement.height }
  get landBounds()        { return this.cachedLandBounds ?? this.computeLandBounds() }
  get allTilesRequested() {
    return (this.tileCache.size + this.runtimeOmittedTiles.size + (this.activeMap?.omittedTilesCount ?? 0)) >= (this.activeMap?.totalTiles ?? 0)
  }

  computeLandBounds() {
    if (!this.activeMap) return (this.cachedLandBounds = null)

    const { rows, columns, tileSize, width, height }        = this.activeMap
    let minimumColumn = Infinity, maximumColumn = -Infinity, minimumRow = Infinity, maximumRow = -Infinity, hasLand = false

    for (let row = 1; row <= rows; row += 1) {
      for (let column = 1; column <= columns; column += 1) {
        if (!this.activeMap.isTileOmitted(column, row)) {
          hasLand = true
          if (column < minimumColumn) minimumColumn = column
          if (column > maximumColumn) maximumColumn = column
          if (row    < minimumRow)    minimumRow    = row
          if (row    > maximumRow)    maximumRow    = row
        }
      }
    }

    if (!hasLand) return (this.cachedLandBounds = { minX: 0, minY: 0, maxX: width, maxY: height, width, height })

    const minimumX     = (minimumColumn                 - 1) * tileSize
    const minimumY     = (minimumRow                    - 1) * tileSize
    const boundsWidth  = (maximumColumn - minimumColumn + 1) * tileSize
    const boundsHeight = (maximumRow    - minimumRow    + 1) * tileSize

    return (this.cachedLandBounds = { minX: minimumX, minY: minimumY, maxX: minimumX + boundsWidth, maxY: minimumY + boundsHeight, width: boundsWidth, height: boundsHeight })
  }

  screenToMapCoordinates(screenX, screenY, relativeToLand = true) {
    if (!this.activeMap) return null

    const boundingBox      = this.canvasElement.getBoundingClientRect()
    const devicePixelRatio = this.pixelRatio
    const absoluteX        = ((screenX - boundingBox.left) * devicePixelRatio - this.positionHorizontal) / this.scaleMultiplier
    const absoluteY        = ((screenY - boundingBox.top)  * devicePixelRatio - this.positionVertical)   / this.scaleMultiplier
    const bounds           = this.landBounds

    return relativeToLand && bounds
      ? { x: absoluteX - bounds.minX, y: absoluteY - bounds.minY, width: bounds.width, height: bounds.height, rawX: absoluteX, rawY: absoluteY }
      : { x: absoluteX, y: absoluteY, width: this.activeMap.width, height: this.activeMap.height }
  }

  mapToScreenCoordinates(mapX, mapY, isRelativeToLand = true) {
    if (!this.activeMap) return null

    const boundingBox       = this.canvasElement.getBoundingClientRect()
    const canvasCoordinates = this.mapToCanvasCoordinates(mapX, mapY, isRelativeToLand)
    const devicePixelRatio  = this.pixelRatio

    return { screenX: boundingBox.left + canvasCoordinates.x / devicePixelRatio, screenY: boundingBox.top + canvasCoordinates.y / devicePixelRatio }
  }

  mapToCanvasCoordinates(mapX, mapY, isRelativeToLand = true) {
    if (!this.activeMap) return null

    const bounds    = this.landBounds
    const absoluteX = isRelativeToLand && bounds ? mapX + bounds.minX : mapX
    const absoluteY = isRelativeToLand && bounds ? mapY + bounds.minY : mapY

    return { x: absoluteX * this.scaleMultiplier + this.positionHorizontal, y: absoluteY * this.scaleMultiplier + this.positionVertical }
  }

  displayMap(targetMap) {
    this.activeMap = targetMap
    this.tileCache.clear()
    this.runtimeOmittedTiles.clear()
    this.computeLandBounds()
    this.setupOverviewCanvas()
    this.fitToScreen()
    this.requestRender()
  }

  setupOverviewCanvas() {
    if (!this.activeMap) return

    this.overviewScale         = Math.min(1, 4096 / Math.max(this.activeMap.width, this.activeMap.height))
    this.overviewCanvas        = document.createElement('canvas')
    this.overviewCanvas.width  = Math.round(this.activeMap.width  * this.overviewScale)
    this.overviewCanvas.height = Math.round(this.activeMap.height * this.overviewScale)
    this.overviewContext       = this.overviewCanvas.getContext('2d')
  }

  drawTileToOverview(column, row, imageElement) {
    if (!this.overviewContext || !this.activeMap) return

    const overviewTileSize = this.activeMap.tileSize * this.overviewScale
    const left             = Math.round((column - 1) * overviewTileSize)
    const top              = Math.round((row    - 1) * overviewTileSize)
    const right            = Math.round(column       * overviewTileSize)
    const bottom           = Math.round(row          * overviewTileSize)

    this.overviewContext.drawImage(imageElement, left, top, right - left, bottom - top)
  }

  fitToScreen() {
    if (!this.activeMap) return

    const devicePixelRatio    = this.pixelRatio
    this.canvasElement.width  = this.canvasElement.clientWidth  * devicePixelRatio
    this.canvasElement.height = this.canvasElement.clientHeight * devicePixelRatio

    const scaleWidth          = this.canvasElement.width  / this.activeMap.width
    const scaleHeight         = this.canvasElement.height / this.activeMap.height
    const minimumAllowedScale = (48 * devicePixelRatio)   / this.activeMap.tileSize

    this.scaleMultiplier    = Math.max(minimumAllowedScale, Math.min(scaleWidth, scaleHeight))
    this.positionHorizontal = (this.canvasElement.width  - this.activeMap.width  * this.scaleMultiplier) * 0.5
    this.positionVertical   = (this.canvasElement.height - this.activeMap.height * this.scaleMultiplier) * 0.5
    this.minimumScale       = Math.min(scaleWidth, scaleHeight) * 0.5
    this.maximumScale       = Math.max(4 * devicePixelRatio, this.scaleMultiplier)
  }

  getTileRecord(column, row) {
    const tileCacheKey = `${column}x${row}`
    if (this.runtimeOmittedTiles.has(tileCacheKey)) return null

    let tileRecord = this.tileCache.get(tileCacheKey)
    if (tileRecord) return tileRecord

    const loadingMap = this.activeMap
    tileRecord = { imageElement: new Image(), isLoaded: false }

    tileRecord.imageElement.onload = () => {
      if (this.activeMap !== loadingMap) return
      tileRecord.isLoaded = true
      this.drawTileToOverview(column, row, tileRecord.imageElement)
      this.requestRender()
    }

    tileRecord.imageElement.onerror = () => {
      if (this.activeMap !== loadingMap) return
      this.runtimeOmittedTiles.add(tileCacheKey)
      this.tileCache.delete(tileCacheKey)
    }

    tileRecord.imageElement.src = loadingMap.getTileLocation(column, row)
    this.tileCache.set(tileCacheKey, tileRecord)

    return tileRecord
  }

  render() {
    this.animationFrameIdentifier = null

    const context = this.renderingContext
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height)

    if (!this.activeMap) return

    const tileSpanPixels     = this.activeMap.tileSize * this.scaleMultiplier
    const useOverviewLayer   = tileSpanPixels < 40
    const firstVisibleColumn = Math.max(1,                      Math.floor(-this.positionHorizontal                             / tileSpanPixels) + 1)
    const lastVisibleColumn  = Math.min(this.activeMap.columns, Math.floor((this.canvasElement.width - this.positionHorizontal) / tileSpanPixels) + 1)
    const firstVisibleRow    = Math.max(1,                      Math.floor(-this.positionVertical                               / tileSpanPixels) + 1)
    const lastVisibleRow     = Math.min(this.activeMap.rows,    Math.floor((this.canvasElement.height - this.positionVertical)  / tileSpanPixels) + 1)

    if (useOverviewLayer && this.overviewCanvas) {
      context.drawImage(
        this.overviewCanvas,
        this.positionHorizontal,
        this.positionVertical,
        (this.overviewCanvas.width  / this.overviewScale) * this.scaleMultiplier,
        (this.overviewCanvas.height / this.overviewScale) * this.scaleMultiplier
      )
      if (this.allTilesRequested) return
    }

    const baseHorizontal = Math.round(this.positionHorizontal)
    const baseVertical   = Math.round(this.positionVertical)

    for (let row = firstVisibleRow; row <= lastVisibleRow; row += 1) {
      const top    = baseVertical + Math.round((row - 1) * tileSpanPixels)
      const bottom = baseVertical + Math.round(row       * tileSpanPixels)

      for (let column = firstVisibleColumn; column <= lastVisibleColumn; column += 1) {
        if (this.activeMap.isTileOmitted?.(column, row)) continue

        const tileRecord = this.getTileRecord(column, row)
        if (useOverviewLayer || !tileRecord?.isLoaded) continue

        const left  = baseHorizontal + Math.round((column - 1) * tileSpanPixels)
        const right = baseHorizontal + Math.round(column       * tileSpanPixels)

        context.drawImage(tileRecord.imageElement, left, top, right - left, bottom - top)
      }
    }
  }

  requestRender() {
    if (this.animationFrameIdentifier === null) {
      this.animationFrameIdentifier = requestAnimationFrame(() => this.render())
    }
  }

  bindEventListeners() {
    window.addEventListener('resize', () => {
      this.fitToScreen()
      this.requestRender()
    })

    this.canvasElement.addEventListener('wheel', (event) => {
      event.preventDefault()

      const devicePixelRatio  = this.pixelRatio
      const boundingBox       = this.canvasElement.getBoundingClientRect()
      const nextScale         = Math.min(this.maximumScale, Math.max(this.minimumScale, this.scaleMultiplier * (event.deltaY < 0 ? 1.2 : 1 / 1.2)))
      const zoomFactor        = nextScale / this.scaleMultiplier
      const pointerHorizontal = (event.clientX - boundingBox.left) * devicePixelRatio
      const pointerVertical   = (event.clientY - boundingBox.top)  * devicePixelRatio

      this.positionHorizontal = pointerHorizontal - (pointerHorizontal - this.positionHorizontal) * zoomFactor
      this.positionVertical   = pointerVertical   - (pointerVertical   - this.positionVertical)   * zoomFactor
      this.scaleMultiplier    = nextScale

      this.requestRender()
    }, { passive: false })

    this.canvasElement.addEventListener('pointerdown', (event) => {
      this.isDragging            = true
      this.lastPointerHorizontal = event.clientX
      this.lastPointerVertical   = event.clientY
      this.canvasElement.setPointerCapture(event.pointerId)
      this.canvasElement.style.cursor = 'grabbing'
    })

    this.canvasElement.addEventListener('pointermove', (event) => {
      if (!this.isDragging) return

      const devicePixelRatio = this.pixelRatio
      this.positionHorizontal += (event.clientX - this.lastPointerHorizontal) * devicePixelRatio
      this.positionVertical   += (event.clientY - this.lastPointerVertical)   * devicePixelRatio

      this.lastPointerHorizontal = event.clientX
      this.lastPointerVertical   = event.clientY

      this.requestRender()
    })

    const terminateDragging = () => {
      this.isDragging                 = false
      this.canvasElement.style.cursor = 'grab'
    }

    this.canvasElement.addEventListener('pointerup',     terminateDragging)
    this.canvasElement.addEventListener('pointercancel', terminateDragging)
  }
}

export default MapRenderer