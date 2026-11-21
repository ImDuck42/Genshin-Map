export class Spot {
  constructor(entry, imageLocation) {
    this.id     = Number(entry.id)
    this.mapId  = Number(entry.mapId)
    this.coords = { x: Number(entry.coords.x), y: Number(entry.coords.y) }
    this.image  = imageLocation
  }

  checkGuess(x, y) {
    const distance = Math.hypot(this.coords.x - Number(x), this.coords.y - Number(y))
    return {
      exact:              distance === 0,
      distance:           distance,
      correctCoordinates: { ...this.coords },
    }
  }
}

export class SpotLoader {
  constructor(indexLocationPath) {
    this.indexLocationPath = indexLocationPath
    this.spotLocation      = null
    this.isLoaded          = false
    this.spotsCollection   = []
    this.spotsById         = new Map()
  }

  get allSpots()   { return this.spotsCollection }
  get totalSpots() { return this.spotsCollection.length }

  getSpotById(id)        { return this.spotsById.get(Number(id)) ?? null }
  getSpotsByMapId(mapId) { return this.spotsCollection.filter((s) => s.mapId === Number(mapId)) }

  getRandomSpot(targetMapId = null) {
    const pool = targetMapId === null ? this.spotsCollection : this.getSpotsByMapId(targetMapId)
    return pool.length === 0 ? null : pool[Math.floor(Math.random() * pool.length)]
  }

  async load() {
    const indexUrl = new URL(this.indexLocationPath, window.location.href)
    const response = await fetch(indexUrl.href)
    if (!response.ok) throw new Error(`[SpotLoader] Failed fetching index: ${response.statusText}`)

    const payload     = await response.json()
    this.spotLocation = new URL(`${payload.spotLocation.replace(/\/$/, '')}/`, new URL('.', indexUrl)).href

    this.spotsCollection = (payload.spots ?? []).map((entry) => {
      const spot = new Spot(entry, new URL(`${entry.id}.png`, this.spotLocation).href)
      this.spotsById.set(spot.id, spot)
      return spot
    })

    this.isLoaded = true
    return this
  }
}

export default SpotLoader