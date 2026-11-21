/**
 * ============================================================================
 * USAGE:
 *   import { originalPath } from './originalPath.js' // From GHP Url for MIME-Type support
 *
 *   // Default Ultra Native 1:1 scale (P0)
 *   const nativeLocation = await originalPath(34, '1x1')
 *   // Output: https://act-webstatic.hoyoverse.com/map_manage/map/34/hash/0_0_P0.webp
 *
 *   // With Quality Option (P0, N1, N2, N3, N4)
 *   const overviewLocation = await originalPath(34, '1x1', 'N4')
 *   // Output: https://act-webstatic.hoyoverse.com/map_manage/map/34/hash/0_0_N4.webp
 *
 * ----------------------------------------------------------------------------
 * INDEXING CONVERSION:
 *   Input:  1-based coordinate string (e.g. '1x1',       '16x16')
 *   Output: 0-based remote tile       (e.g. 0_0_P0.webp, 15_15_P0.webp)
 *
 * ----------------------------------------------------------------------------
 * SUPPORTED QUALITY TIERS:
 *   - P0: Ultra / Native 1:1 scale (256px world step)
 *   - N1: High resolution          (1:2  downscale, 512px  world step)
 *   - N2: Medium resolution        (1:4  downscale, 1024px world step)
 *   - N3: Low resolution           (1:8  downscale, 2048px world step)
 *   - N4: Overview resolution      (1:16 downscale, 4096px world step)
 *
 * > Automatic grid bounds validation prevents requests to non-existent tiles
 * ============================================================================
 */

export const CDN_BASE_ENDPOINT = 'https://act-webstatic.hoyoverse.com/map_manage/map'
export const API_BASE_ENDPOINT = 'https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v3/map'

export const QUALITY_LEVELS = Object.freeze({
  P0: {
    scaleMultiplier: 1,
    worldStepPixels: 256,
    identifier:      'P0',
    description:     'Ultra / Full native resolution (1:1 scale)',
  },
  N1: {
    scaleMultiplier: 2,
    worldStepPixels: 512,
    identifier:      'N1',
    description:     'High resolution (1:2 downscale)',
  },
  N2: {
    scaleMultiplier: 4,
    worldStepPixels: 1024,
    identifier:      'N2',
    description:     'Medium resolution (1:4 downscale)',
  },
  N3: {
    scaleMultiplier: 8,
    worldStepPixels: 2048,
    identifier:      'N3',
    description:     'Low resolution (1:8 downscale)',
  },
  N4: {
    scaleMultiplier: 16,
    worldStepPixels: 4096,
    identifier:      'N4',
    description:     'Overview resolution (1:16 downscale)',
  },
})

// In-memory cache for map metadata promises
const mapMetadataCache = new Map()

/**
 * Retrieves the asset version hash and layout dimensions for a map
 * @param   {number|string} mapIdentifier
 * @param   {string}        [languageCode='en-us']
 * @returns {Promise<Object>}
 */
export async function getMapMetadata(mapIdentifier, languageCode = 'en-us') {
  const parsedIdentifier = Number(mapIdentifier)

  if (mapMetadataCache.has(parsedIdentifier)) {
    return mapMetadataCache.get(parsedIdentifier)
  }

  const fetchPromise = (async () => {
    const endpointLocation = `${API_BASE_ENDPOINT}/info?app_sn=ys_obc&lang=${languageCode}&map_id=${parsedIdentifier}`
    const response         = await fetch(endpointLocation)

    if (!response.ok) {
      throw new Error(`[originalPath] Failed fetching map info for ID ${parsedIdentifier}: ${response.statusText}`)
    }

    const payload        = await response.json()
    const rawInformation = payload.data?.info

    if (!rawInformation) {
      throw new Error(`[originalPath] No map info payload returned for ID ${parsedIdentifier}`)
    }

    const detailRaw     = rawInformation.detail_v2 || rawInformation.detail
    const detailPayload = typeof detailRaw === 'string' ? JSON.parse(detailRaw) : detailRaw

    if (!detailPayload?.map_version || !detailPayload.total_size?.length) {
      throw new Error(`[originalPath] Missing map_version or total_size in API response for ID ${parsedIdentifier}`)
    }

    const [totalWidthPixels, totalHeightPixels] = detailPayload.total_size

    return {
      versionHash: detailPayload.map_version,
      totalWidthPixels,
      totalHeightPixels,
    }
  })()

  mapMetadataCache.set(parsedIdentifier, fetchPromise)
  fetchPromise.catch(() => mapMetadataCache.delete(parsedIdentifier))

  return fetchPromise
}

/**
 * Resolves a map identifier and tile coordinate to the original HoYoverse CDN URL
 * @param   {number|string} mapIdentifier       - Map identifier (e.g. 34, 2)
 * @param   {string}        tileCoordinate      - Coordinate string formatted as 'columnxrow' (e.g. '1x1')
 * @param   {string}        [qualityLevel='P0'] - Quality option ('P0', 'N1', 'N2', 'N3', 'N4')
 * @returns {Promise<string>}                   - The remote official WebP CDN URL
 */
export async function originalPath(
  mapIdentifier,
  tileCoordinate,
  qualityLevel = 'P0'
) {
  const coordinateParts  = String(tileCoordinate).trim().split('x')
  const columnCoordinate = Number(coordinateParts[0])
  const rowCoordinate    = Number(coordinateParts[1])

  if (!columnCoordinate || !rowCoordinate || columnCoordinate < 1 || rowCoordinate < 1) {
    throw new Error(
      `[originalPath] Invalid coordinate: "${tileCoordinate}". Expected 1-based format like "1x1".`
    )
  }

  if (!QUALITY_LEVELS[qualityLevel]) {
    const supportedQualities = Object.keys(QUALITY_LEVELS).join(', ')
    throw new Error(
      `[originalPath] Quality level "${qualityLevel}" is not available. Supported qualities are: ${supportedQualities}.`
    )
  }

  const qualityConfiguration = QUALITY_LEVELS[qualityLevel]
  const mapMetadata          = await getMapMetadata(mapIdentifier)

  const maximumColumns = Math.ceil(mapMetadata.totalWidthPixels  / qualityConfiguration.worldStepPixels)
  const maximumRows    = Math.ceil(mapMetadata.totalHeightPixels / qualityConfiguration.worldStepPixels)

  if (columnCoordinate > maximumColumns || rowCoordinate > maximumRows) {
    throw new Error(
      `[originalPath] Coordinate "${tileCoordinate}" is out of bounds for quality "${qualityLevel}". Maximum grid size at this quality is ${maximumColumns}x${maximumRows}.`
    )
  }

  // 1-based coordinate input converts to 0-based CDN coordinate
  const cdnColumnCoordinate = Math.max(0, columnCoordinate - 1)
  const cdnRowCoordinate    = Math.max(0, rowCoordinate    - 1)

  return `${CDN_BASE_ENDPOINT}/${mapIdentifier}/${mapMetadata.versionHash}/${cdnColumnCoordinate}_${cdnRowCoordinate}_${qualityLevel}.webp`
}

window.originalPath = originalPath
export default originalPath