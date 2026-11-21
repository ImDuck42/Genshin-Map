export class GenshinMap {
  constructor(config) {
    this.identifier        = Number(config.mapId)
    this.name              = config.name
    this.resolution        = config.resolution
    this.folder            = config.folderName
    this.tileSize          = config.tileSize
    this.columns           = config.totalColumns
    this.rows              = config.totalRows
    this.width             = config.totalWidth
    this.height            = config.totalHeight
    this.totalTiles        = config.totalColumns * config.totalRows
    this.naming            = config.naming
    this.indexing          = config.indexing
    this.metadata          = config.metadataLocation
    this.tileBaseDirectory = config.tileFolderLocation
    this.omittedTiles      = new Set(config.omittedTiles ?? [])
  }

  get omittedTilesCount() { return this.omittedTiles.size }
  get aspectRatio()       { return this.width / this.height }

  isTileOmitted(columnCoordinate, rowCoordinate) {
    return this.omittedTiles.has(`${columnCoordinate}x${rowCoordinate}`)
  }

  hasTile(columnCoordinate, rowCoordinate) {
    return !this.isTileOmitted(columnCoordinate, rowCoordinate)
  }

  getTileLocation(columnCoordinate, rowCoordinate) {
    const targetColumn = this.indexing === '1-based'
      ? Math.max(1, Math.min(columnCoordinate, this.columns))
      : columnCoordinate

    const targetRow = this.indexing === '1-based'
      ? Math.max(1, Math.min(rowCoordinate, this.rows))
      : rowCoordinate

    const fileName = this.naming
      .replace('{column}', targetColumn)
      .replace('{row}',    targetRow)

    return `${this.tileBaseDirectory}/${fileName}`
  }
}

export class MapLoader {
  constructor(indexLocationPath) {
    this.indexLocationPath = indexLocationPath
    this.loadedStatus      = false
    this.mapsCollection    = []
    this.mapsByIdentifier  = new Map()
    this.mapsByName        = new Map()
    this.dynamicKeys       = new Set()
  }

  get isLoaded()       { return this.loadedStatus }
  get allMaps()        { return this.mapsCollection }
  get totalMaps()      { return this.mapsCollection.length }
  get mapIdentifiers() { return this.mapsCollection.map((map) => map.identifier) }
  get mapNames()       { return this.mapsCollection.map((map) => map.name) }
  get defaultMap()     { return this.mapsCollection[0] ?? null }

  getMapByIdentifier(targetIdentifier) {
    return this.mapsByIdentifier.get(Number(targetIdentifier)) ?? null
  }

  getMapByName(targetName) {
    return this.mapsByName.get(targetName) ?? null
  }

  async fetchMap(mapEntry, absoluteIndexLocation) {
    const metadataLocation = new URL(mapEntry.metadata, absoluteIndexLocation).href
    const metadataResponse = await fetch(metadataLocation)

    if (!metadataResponse.ok) {
      return null
    }

    const metadataPayload    = await metadataResponse.json()
    const tileFolderLocation = metadataLocation.slice(0, metadataLocation.lastIndexOf('/'))

    return new GenshinMap({
      ...metadataPayload,
      folderName:         mapEntry.folderName,
      metadataLocation:   metadataLocation,
      tileFolderLocation: tileFolderLocation,
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

    for (const key of this.dynamicKeys) {
      delete this[key]
    }
    this.dynamicKeys.clear()

    this.mapsCollection   = loadedMaps
    this.mapsByIdentifier = new Map(loadedMaps.map((map) => [map.identifier, map]))
    this.mapsByName       = new Map(loadedMaps.map((map) => [map.name, map]))

    for (const map of loadedMaps) {
      if (map.folder && !(map.folder in this)) {
        this[map.folder] = map
        this.dynamicKeys.add(map.folder)
      }

      const identifierKey = `map${map.identifier}`
      if (!(identifierKey in this)) {
        this[identifierKey] = map
        this.dynamicKeys.add(identifierKey)
      }
    }

    this.loadedStatus = true
    return this
  }
}

export default MapLoader