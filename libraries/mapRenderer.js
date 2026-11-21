export class MapRenderer {
  constructor(canvasTarget, initialMap = null) {
    this.canvasElement = typeof canvasTarget === 'string'
      ? document.querySelector(canvasTarget)
      : canvasTarget
    this.renderingContext = this.canvasElement.getContext('2d', { alpha: true })

    this.activeMap           = initialMap
    this.tileCache           = new Map()
    this.runtimeOmittedTiles = new Set()
    this.cachedLandBounds    = null

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

  get currentMap() {
    return this.activeMap
  }

  get zoomLevel() {
    return this.scaleMultiplier
  }

  get pixelRatio() {
    return window.devicePixelRatio || 1
  }

  get canvasWidth() {
    return this.canvasElement.width
  }

  get canvasHeight() {
    return this.canvasElement.height
  }

  get allTilesRequested() {
    return this.tileCache.size + this.runtimeOmittedTiles.size + this.activeMap.omittedTilesCount
      >= this.activeMap.totalTiles
  }

  get landBounds() {
    if (!this.cachedLandBounds && this.activeMap) {
      this.computeLandBounds()
    }
    return this.cachedLandBounds
  }

  computeLandBounds() {
    if (!this.activeMap) {
      this.cachedLandBounds = null
      return null
    }

    let minColumn = Infinity
    let maxColumn = -Infinity
    let minRow    = Infinity
    let maxRow    = -Infinity
    let hasLand   = false

    for (let row = 1; row <= this.activeMap.rows; row += 1) {
      for (let column = 1; column <= this.activeMap.columns; column += 1) {
        if (!this.activeMap.isTileOmitted(column, row)) {
          hasLand = true
          if (column < minColumn) minColumn = column
          if (column > maxColumn) maxColumn = column
          if (row    < minRow)    minRow    = row
          if (row    > maxRow)    maxRow    = row
        }
      }
    }

    if (!hasLand) {
      this.cachedLandBounds = {
        minX:   0,
        minY:   0,
        maxX:   this.activeMap.width,
        maxY:   this.activeMap.height,
        width:  this.activeMap.width,
        height: this.activeMap.height,
      }
      return this.cachedLandBounds
    }

    const tileSize = this.activeMap.tileSize
    const minX     = (minColumn             - 1) * tileSize
    const minY     = (minRow                - 1) * tileSize
    const width    = (maxColumn - minColumn + 1) * tileSize
    const height   = (maxRow    - minRow    + 1) * tileSize

    this.cachedLandBounds = {
      minX:   minX,
      minY:   minY,
      maxX:   minX + width,
      maxY:   minY + height,
      width:  width,
      height: height,
    }

    return this.cachedLandBounds
  }

  screenToMapCoordinates(screenX, screenY, relativeToLand = true) {
    if (!this.activeMap) {
      return null
    }

    const boundingBox      = this.canvasElement.getBoundingClientRect()
    const devicePixelRatio = this.pixelRatio
    const canvasPixelX     = (screenX - boundingBox.left) * devicePixelRatio
    const canvasPixelY     = (screenY - boundingBox.top)  * devicePixelRatio

    const absoluteX        = (canvasPixelX - this.positionHorizontal) / this.scaleMultiplier
    const absoluteY        = (canvasPixelY - this.positionVertical)   / this.scaleMultiplier

    const bounds = this.landBounds

    if (relativeToLand && bounds) {
      return {
        x:      absoluteX - bounds.minX,
        y:      absoluteY - bounds.minY,
        width:  bounds.width,
        height: bounds.height,
        rawX:   absoluteX,
        rawY:   absoluteY,
      }    
    }

    return {
      x:      absoluteX,
      y:      absoluteY,
      width:  this.activeMap.width,
      height: this.activeMap.height,
    }
  }

  mapToScreenCoordinates(mapX, mapY, isRelativeToLand = true) {
    if (!this.activeMap) {
      return null
    }

    const bounds           = this.landBounds
    const absoluteX        = isRelativeToLand && bounds ? mapX + bounds.minX : mapX
    const absoluteY        = isRelativeToLand && bounds ? mapY + bounds.minY : mapY

    const canvasPixelX     = absoluteX * this.scaleMultiplier + this.positionHorizontal
    const canvasPixelY     = absoluteY * this.scaleMultiplier + this.positionVertical

    const boundingBox      = this.canvasElement.getBoundingClientRect()
    const devicePixelRatio = this.pixelRatio

    return {
      screenX: boundingBox.left + canvasPixelX / devicePixelRatio,
      screenY: boundingBox.top  + canvasPixelY / devicePixelRatio,
    }
  }

  mapToCanvasCoordinates(mapX, mapY, isRelativeToLand = true) {
    if (!this.activeMap) {
      return null
    }

    const bounds    = this.landBounds
    const absoluteX = isRelativeToLand && bounds ? mapX + bounds.minX : mapX
    const absoluteY = isRelativeToLand && bounds ? mapY + bounds.minY : mapY

    return {
      x: absoluteX * this.scaleMultiplier + this.positionHorizontal,
      y: absoluteY * this.scaleMultiplier + this.positionVertical,
    }
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
    if (!this.activeMap) {
      return
    }

    const maximumOverviewDimension = 4096
    this.overviewScale             = Math.min(
      1,
      maximumOverviewDimension / Math.max(this.activeMap.width, this.activeMap.height)
    )

    this.overviewCanvas        = document.createElement('canvas')
    this.overviewCanvas.width  = Math.round(this.activeMap.width  * this.overviewScale)
    this.overviewCanvas.height = Math.round(this.activeMap.height * this.overviewScale)
    this.overviewContext       = this.overviewCanvas.getContext('2d')
  }

  drawTileToOverview(columnCoordinate, rowCoordinate, imageElement) {
    if (!this.overviewContext || !this.activeMap) {
      return
    }

    const overviewTileSize = this.activeMap.tileSize * this.overviewScale

    this.overviewContext.drawImage(
      imageElement,
      (columnCoordinate - 1) * overviewTileSize,
      (rowCoordinate    - 1) * overviewTileSize,
      overviewTileSize       + 0.5,
      overviewTileSize       + 0.5
    )
  }

  fitToScreen() {
    if (!this.activeMap) {
      return
    }

    const devicePixelRatio    = this.pixelRatio
    this.canvasElement.width  = this.canvasElement.clientWidth  * devicePixelRatio
    this.canvasElement.height = this.canvasElement.clientHeight * devicePixelRatio

    const scaleWidth  = this.canvasElement.width  / this.activeMap.width
    const scaleHeight = this.canvasElement.height / this.activeMap.height

    const minimumDisplayTileSize = 48
    const minimumAllowedScale    = (minimumDisplayTileSize * devicePixelRatio) / this.activeMap.tileSize

    this.scaleMultiplier    = Math.max(minimumAllowedScale, Math.min(scaleWidth, scaleHeight))
    this.positionHorizontal = (this.canvasElement.width  - this.activeMap.width  * this.scaleMultiplier) / 2
    this.positionVertical   = (this.canvasElement.height - this.activeMap.height * this.scaleMultiplier) / 2

    this.minimumScale = Math.min(scaleWidth, scaleHeight) * 0.5
    this.maximumScale = Math.max(4 * devicePixelRatio, this.scaleMultiplier)
  }

  getTileRecord(columnCoordinate, rowCoordinate) {
    const tileCacheKey = `${columnCoordinate}x${rowCoordinate}`

    if (this.runtimeOmittedTiles.has(tileCacheKey)) {
      return null
    }

    let tileRecord = this.tileCache.get(tileCacheKey)

    if (tileRecord) {
      return tileRecord
    }

    const loadingMap = this.activeMap

    tileRecord = {
      imageElement: new Image(),
      isLoaded:     false,
    }

    tileRecord.imageElement.onload = () => {
      tileRecord.imageElement.decode().catch(() => {}).finally(() => {
        if (this.activeMap !== loadingMap) {
          return
        }
        tileRecord.isLoaded = true
        this.drawTileToOverview(columnCoordinate, rowCoordinate, tileRecord.imageElement)
        this.requestRender()
      })
    }

    tileRecord.imageElement.onerror = () => {
      if (this.activeMap !== loadingMap) {
        return
      }
      this.runtimeOmittedTiles.add(tileCacheKey)
      this.tileCache.delete(tileCacheKey)
    }

    tileRecord.imageElement.src = loadingMap.getTileLocation(
      columnCoordinate,
      rowCoordinate
    )

    this.tileCache.set(tileCacheKey, tileRecord)

    return tileRecord
  }

  render() {
    this.animationFrameIdentifier = null

    this.renderingContext.setTransform(1, 0, 0, 1, 0, 0)
    this.renderingContext.clearRect(
      0,
      0,
      this.canvasElement.width,
      this.canvasElement.height
    )

    if (!this.activeMap) {
      return
    }

    const tileSpanPixels     = this.activeMap.tileSize * this.scaleMultiplier
    const useOverviewLayer   = tileSpanPixels < 40
    const firstVisibleColumn = Math.max(
      1,
      Math.floor(-this.positionHorizontal / tileSpanPixels) + 1
    )
    const lastVisibleColumn = Math.min(
      this.activeMap.columns,
      Math.floor((this.canvasElement.width - this.positionHorizontal) / tileSpanPixels) + 1
    )
    const firstVisibleRow = Math.max(
      1,
      Math.floor(-this.positionVertical / tileSpanPixels) + 1
    )
    const lastVisibleRow = Math.min(
      this.activeMap.rows,
      Math.floor((this.canvasElement.height - this.positionVertical) / tileSpanPixels) + 1
    )

    if (useOverviewLayer && this.overviewCanvas) {
      this.renderingContext.drawImage(
        this.overviewCanvas,
        this.positionHorizontal,
        this.positionVertical,
        (this.overviewCanvas.width  / this.overviewScale) * this.scaleMultiplier,
        (this.overviewCanvas.height / this.overviewScale) * this.scaleMultiplier
      )
    }

    if (useOverviewLayer && this.allTilesRequested) {
      return
    }

    for (let rowCoordinate = firstVisibleRow; rowCoordinate <= lastVisibleRow; rowCoordinate += 1) {
      for (let columnCoordinate = firstVisibleColumn; columnCoordinate <= lastVisibleColumn; columnCoordinate += 1) {
        if (this.activeMap.isTileOmitted?.(columnCoordinate, rowCoordinate)) {
          continue
        }

        const tileRecord = this.getTileRecord(columnCoordinate, rowCoordinate)

        if (useOverviewLayer || !tileRecord || !tileRecord.isLoaded) {
          continue
        }

        const screenPositionHorizontal = this.positionHorizontal + (columnCoordinate - 1) * tileSpanPixels
        const screenPositionVertical   = this.positionVertical   + (rowCoordinate    - 1) * tileSpanPixels

        this.renderingContext.drawImage(
          tileRecord.imageElement,
          screenPositionHorizontal,
          screenPositionVertical,
          tileSpanPixels + 0.5,
          tileSpanPixels + 0.5
        )
      }
    }
  }

  requestRender() {
    if (this.animationFrameIdentifier !== null) {
      return
    }

    this.animationFrameIdentifier = requestAnimationFrame(() => this.render())
  }

  bindEventListeners() {
    window.addEventListener('resize', () => {
      this.fitToScreen()
      this.requestRender()
    })

    this.canvasElement.addEventListener('wheel', (event) => {
      event.preventDefault()

      const devicePixelRatio = this.pixelRatio
      const boundingBox      = this.canvasElement.getBoundingClientRect()

      const nextScale = Math.min(
        this.maximumScale,
        Math.max(this.minimumScale, this.scaleMultiplier * (event.deltaY < 0 ? 1.2 : 1 / 1.2))
      )
      const zoomFactor = nextScale / this.scaleMultiplier

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
      if (!this.isDragging) {
        return
      }

      const devicePixelRatio = this.pixelRatio
      const deltaHorizontal  = (event.clientX - this.lastPointerHorizontal) * devicePixelRatio
      const deltaVertical    = (event.clientY - this.lastPointerVertical)   * devicePixelRatio

      this.positionHorizontal += deltaHorizontal
      this.positionVertical   += deltaVertical

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