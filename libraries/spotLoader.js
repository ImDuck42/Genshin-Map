export class Spot {
  constructor(spotEntry, imageLocation) {
    this.id     = Number(spotEntry.id)
    this.mapId  = Number(spotEntry.mapId)
    this.coords = {
      x: Number(spotEntry.coords.x),
      y: Number(spotEntry.coords.y),
    }
    this.image  = imageLocation
  }

  checkGuess(x, y) {
    const guessX = Number(x)
    const guessY = Number(y)

    if (!Number.isFinite(guessX) || !Number.isFinite(guessY)) {
      throw new TypeError('Spot.checkGuess expects numeric x and y values')
    }

    const distance = Math.hypot(this.coords.x - guessX, this.coords.y - guessY)

    return {
      exact: distance === 0,
      distance,
      correctCoordinates: { ...this.coords },
    }
  }
}

export class SpotLoader {
  constructor(indexLocationPath) {
    this.indexLocationPath = indexLocationPath
    this.spotLocation      = null
    this.loadedStatus      = false
    this.spotsCollection   = []
    this.spotsById         = new Map()
  }

  get isLoaded() {
    return this.loadedStatus
  }

  get allSpots() {
    return [...this.spotsCollection]
  }

  get totalSpots() {
    return this.spotsCollection.length
  }

  getSpotById(targetId) {
    return this.spotsById.get(Number(targetId)) ?? null
  }

  getSpotsByMapId(targetMapId) {
    return this.spotsCollection.filter((spot) => spot.mapId === Number(targetMapId))
  }

  getRandomSpot(targetMapId = null) {
    const availableSpots = targetMapId === null
      ? this.spotsCollection
      : this.getSpotsByMapId(targetMapId)

    if (availableSpots.length === 0) {
      return null
    }

    const randomIndex = Math.floor(Math.random() * availableSpots.length)
    return availableSpots[randomIndex]
  }

  async load() {
    const absoluteIndexLocation = new URL(this.indexLocationPath, window.location.href)
    const indexResponse         = await fetch(absoluteIndexLocation.href)

    if (!indexResponse.ok) {
      throw new Error(`[SpotLoader] Failed fetching index: ${indexResponse.statusText}`)
    }

    const indexPayload   = await indexResponse.json()
    const indexDirectory = new URL('.', absoluteIndexLocation)

    this.spotLocation = new URL(
      `${indexPayload.spotLocation.replace(/\/$/, '')}/`,
      indexDirectory
    ).href

    const loadedSpots = (indexPayload.spots ?? []).map((spotEntry) => {
      const imageLocation = new URL(`${spotEntry.id}.png`, this.spotLocation).href
      return new Spot(spotEntry, imageLocation)
    })

    this.spotsCollection.length = 0
    this.spotsById.clear()

    for (const spot of loadedSpots) {
      this.spotsCollection.push(spot)
      this.spotsById.set(spot.id, spot)
    }

    this.loadedStatus = true
    return this
  }
}

export default SpotLoader