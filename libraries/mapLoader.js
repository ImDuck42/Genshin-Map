export class GenshinMap {
  constructor(mapConfiguration) {
    this.mapIdentifier          = mapConfiguration.mapIdentifier
    this.mapName                = mapConfiguration.mapName
    this.resolutionTier         = mapConfiguration.resolutionTier
    this.folderName             = mapConfiguration.folderName
    this.tileSizePixels         = mapConfiguration.tileSizePixels
    this.totalColumns           = mapConfiguration.totalColumns
    this.totalRows              = mapConfiguration.totalRows
    this.totalWidthPixels       = mapConfiguration.totalWidthPixels
    this.totalHeightPixels      = mapConfiguration.totalHeightPixels
    this.namingPattern          = mapConfiguration.namingPattern
    this.indexingScheme         = mapConfiguration.indexingScheme
    this.metadataLocation       = mapConfiguration.metadataLocation
    this.tileFolderLocation     = mapConfiguration.tileFolderLocation
    this.omittedTilesCollection = new Set(mapConfiguration.omittedTilesCollection ?? [])
  }

  get identifier() {
    return this.mapIdentifier
  }

  get name() {
    return this.mapName
  }

  get resolution() {
    return this.resolutionTier
  }

  get folder() {
    return this.folderName
  }

  get tileSize() {
    return this.tileSizePixels
  }

  get columns() {
    return this.totalColumns
  }

  get rows() {
    return this.totalRows
  }

  get width() {
    return this.totalWidthPixels
  }

  get height() {
    return this.totalHeightPixels
  }

  get totalTiles() {
    return this.totalColumns * this.totalRows
  }

  get omittedTilesCount() {
    return this.omittedTilesCollection.size
  }

  get aspectRatio() {
    return this.totalWidthPixels / this.totalHeightPixels
  }

  get indexing() {
    return this.indexingScheme
  }

  get metadata() {
    return this.metadataLocation
  }

  get tileBaseDirectory() {
    return this.tileFolderLocation
  }

  isTileOmitted(columnCoordinate, rowCoordinate) {
    return this.omittedTilesCollection.has(`${columnCoordinate}x${rowCoordinate}`)
  }

  hasTile(columnCoordinate, rowCoordinate) {
    return !this.isTileOmitted(columnCoordinate, rowCoordinate)
  }

  getTileLocation(columnCoordinate, rowCoordinate) {
    const targetColumn = this.indexingScheme === '1-based'
      ? Math.max(1, Math.min(columnCoordinate, this.totalColumns))
      : columnCoordinate

    const targetRow = this.indexingScheme === '1-based'
      ? Math.max(1, Math.min(rowCoordinate, this.totalRows))
      : rowCoordinate

    const fileName = this.namingPattern
      .replaceAll('{column}', targetColumn)
      .replaceAll('{row}',    targetRow)

    return `${this.tileFolderLocation}/${fileName}`
  }
}

export class MapLoader {
  constructor(indexLocationPath) {
    this.indexLocationPath = indexLocationPath
    this.loadedStatus      = false
    this.mapsCollection    = []
    this.mapsByIdentifier  = new Map()
    this.mapsByName        = new Map()
    this.dynamicAccessors  = new Set()
  }

  get isLoaded() {
    return this.loadedStatus
  }

  get allMaps() {
    return [...this.mapsCollection]
  }

  get totalMaps() {
    return this.mapsCollection.length
  }

  get mapIdentifiers() {
    return this.mapsCollection.map((mapInstance) => mapInstance.identifier)
  }

  get mapNames() {
    return this.mapsCollection.map((mapInstance) => mapInstance.name)
  }

  get defaultMap() {
    return this.mapsCollection[0] ?? null
  }

  getMapByIdentifier(targetIdentifier) {
    return this.mapsByIdentifier.get(Number(targetIdentifier)) ?? null
  }

  getMapByName(targetName) {
    return this.mapsByName.get(targetName) ?? null
  }

  registerAccessor(accessorKey, mapInstance) {
    if (accessorKey in this && !this.dynamicAccessors.has(accessorKey)) {
      console.warn(`[MapLoader] Skipping accessor "${accessorKey}": name already in use`)
      return
    }

    Object.defineProperty(this, accessorKey, {
      get:          () => mapInstance,
      enumerable:   true,
      configurable: true,
    })

    this.dynamicAccessors.add(accessorKey)
  }

  async fetchMap(mapEntry, absoluteIndexLocation) {
    const absoluteMetadataLocation = new URL(mapEntry.metadata, absoluteIndexLocation).href
    const metadataResponse         = await fetch(absoluteMetadataLocation)

    if (!metadataResponse.ok) {
      return null
    }

    const metadataPayload    = await metadataResponse.json()
    const tileFolderLocation = absoluteMetadataLocation.substring(
      0,
      absoluteMetadataLocation.lastIndexOf('/')
    )

    return new GenshinMap({
      mapIdentifier:          Number(metadataPayload.mapId),
      mapName:                metadataPayload.name,
      resolutionTier:         metadataPayload.resolution,
      folderName:             mapEntry.folderName,
      tileSizePixels:         metadataPayload.tileSize,
      totalColumns:           metadataPayload.totalColumns,
      totalRows:              metadataPayload.totalRows,
      totalWidthPixels:       metadataPayload.totalWidth,
      totalHeightPixels:      metadataPayload.totalHeight,
      namingPattern:          metadataPayload.naming,
      indexingScheme:         metadataPayload.indexing,
      omittedTilesCollection: metadataPayload.omittedTiles ?? [],
      metadataLocation:       absoluteMetadataLocation,
      tileFolderLocation:     tileFolderLocation,
    })
  }

  async load() {
    const absoluteIndexLocation = new URL(this.indexLocationPath, window.location.href)
    const indexResponse         = await fetch(absoluteIndexLocation.href)

    if (!indexResponse.ok) {
      throw new Error(`[MapLoader] Failed fetching index: ${indexResponse.statusText}`)
    }

    const indexPayload = await indexResponse.json()
    const mapEntries   = indexPayload.maps ?? []

    const loadedMaps = (
      await Promise.all(mapEntries.map((mapEntry) => this.fetchMap(mapEntry, absoluteIndexLocation)))
    ).filter(Boolean)

    this.mapsCollection.length = 0
    this.mapsByIdentifier.clear()
    this.mapsByName.clear()

    for (const accessorKey of this.dynamicAccessors) {
      delete this[accessorKey]
    }
    this.dynamicAccessors.clear()

    for (const mapInstance of loadedMaps) {
      this.mapsCollection.push(mapInstance)
      this.mapsByIdentifier.set(mapInstance.identifier, mapInstance)
      this.mapsByName.set(mapInstance.name, mapInstance)

      this.registerAccessor(mapInstance.folder, mapInstance)
      this.registerAccessor(`map${mapInstance.identifier}`, mapInstance)
    }

    this.loadedStatus = true
    return this
  }
}

export default MapLoader