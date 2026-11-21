"""
python -m venv .venv
source .venv/bin/activate.fish # Omit fish if using bash/sh etc
pip install -r requirements.txt
# python getGIMaps.py      # Fetch all maps
# python getGIMaps.py 2 40 # Fetch maps by ID's
"""

import io
import os
import re
import json
import math
import shutil
import argparse
import itertools
from functools          import partial
from concurrent.futures import ThreadPoolExecutor

import requests
import numpy as np
from PIL import Image

# ========================= Configuration ========================= #
apiBase         = "https://sg-public-api-static.hoyolab.com/common/map_user/ys_obc/v3/map"
tileCdn         = "https://act-webstatic.hoyoverse.com/map_manage/map"
outputDirectory = "./genshin_maps"
tileSize        = 256
mapIdCeiling    = 100
workerCount     = 16

# Resolution tiers to probe
resolutions = (
  ("P0", 256),
  ("N1", 512),
  ("N2", 1024),
  ("N3", 2048),
  ("N4", 4096),
)

# Spacer color thresholds --- WILL HAVE ISSUES
maxRed   = 32
maxGreen = 53
maxBlue  = 74

session = requests.Session()
adapter = requests.adapters.HTTPAdapter(
  pool_connections = 64,
  pool_maxsize     = 64,
  max_retries      = 3,
)
session.mount("https://", adapter)
session.mount("http://",  adapter)

def sanitizeFilename(name):
  """Removes invalid filesystem characters"""
  return re.sub(r'[\\/*?:"<>|]', "", name).strip().replace(" ", "_")

def buildTileUrl(mapId, version, column, row, resolutionId):
  return f"{tileCdn}/{mapId}/{version}/{column}_{row}_{resolutionId}.webp"

def fetchMapInfo(mapId):
  """Queries the HoYoLAB API for map dimensions and asset version"""
  try:
    response = session.get(
      f"{apiBase}/info",
      params  = {"app_sn": "ys_obc", "lang": "en-us", "map_id": mapId},
      timeout = 10,
    )
    response.raise_for_status()
    payload = response.json()
    info    = (payload.get("data") or {}).get("info")
    if payload.get("retcode") != 0 or not info:
      return None

    detail = info.get("detail_v2") or info.get("detail")
    if isinstance(detail, str):
      detail = json.loads(detail)

    width, height = detail["total_size"]
    return {
      "id":      mapId,
      "name":    info.get("name", f"Map_{mapId}"),
      "version": detail["map_version"],
      "width":   width,
      "height":  height,
    }
  except (requests.RequestException, ValueError, KeyError, TypeError):
    return None

def tileExists(url):
  try:
    return session.head(url, timeout = 5).status_code == 200
  except requests.RequestException:
    return False

def getBestResolution(mapInfo):
  """Finds the highest quality resolution that has tiles on the CDN"""
  for resolutionId, step in resolutions:
    lastColumn = math.ceil(mapInfo["width"]  / step) - 1
    lastRow    = math.ceil(mapInfo["height"] / step) - 1

    # Samples the centre tile and the origin tile
    samples = ((lastColumn // 2, lastRow // 2), (0, 0))
    if any(
      tileExists(buildTileUrl(mapInfo["id"], mapInfo["version"], column, row, resolutionId))
      for column, row in samples
    ):
      return resolutionId, step
  return None

def applyTransparencyFilter(image):
  """Turns spacer tiles and colors transparent"""
  pixels           = np.array(image.convert("RGBA"))
  red, green, blue = (pixels[:, :, channel].astype(np.int16) for channel in range(3))

  isSpacer = (
    (red <= maxRed)
    & (green    <= maxGreen)
    & (blue     <= maxBlue)
    & (blue     >= red   + 4)
    & (blue * 4 >= green * 3)
  )

  pixels[:, :, 3][isSpacer] = 0
  isFullySpacer = np.all(pixels[:, :, 3] == 0)

  return Image.fromarray(pixels, mode = "RGBA"), isFullySpacer

def downloadAndSaveTile(context, coordinate):
  """Downloads, filters, and writes an individual tile to disk if not empty"""
  mapId, version, resolutionId, targetFolder = context
  row, column                                = coordinate

  # 1-indexed naming: Column x Row (e.g. 1x1.png, 1x2.png ... 99x78.png)
  coordinateKey = f"{column + 1}x{row + 1}"
  tileFilename  = f"{coordinateKey}.png"
  tileFilePath  = os.path.join(targetFolder, tileFilename)

  try:
    response = session.get(
      buildTileUrl(mapId, version, column, row, resolutionId),
      timeout = 15,
    )
    response.raise_for_status()

    tileImage, isEmpty = applyTransparencyFilter(Image.open(io.BytesIO(response.content)))

    if isEmpty:
      return coordinateKey, "empty"

    # Save as RGBA PNG
    tileImage.save(tileFilePath, format = "PNG", compress_level = 0)
    return coordinateKey, "saved"

  except (requests.RequestException, OSError):
    return coordinateKey, "failed"

def exportMap(mapInfo):
  """Downloads every tile and saves them directly into a tile folder"""
  resolution = getBestResolution(mapInfo)
  if not resolution:
    print(f"[-] No valid tiles found for {mapInfo['name']}")
    return None

  resolutionId, step = resolution
  totalColumns       = math.ceil(mapInfo["width"]  / step)
  totalRows          = math.ceil(mapInfo["height"] / step)
  totalTiles         = totalColumns * totalRows

  folderName   = f"{mapInfo['id']}_{sanitizeFilename(mapInfo['name'])}_{resolutionId}"
  targetFolder = os.path.join(outputDirectory, folderName)
  tempFolder   = os.path.join(targetFolder, ".temp")
  shutil.rmtree(tempFolder, ignore_errors = True)
  os.makedirs(tempFolder, exist_ok = True)

  print(
    f"\n[+] Exporting: {mapInfo['name']} (ID: {mapInfo['id']}) | Res: {resolutionId}"
    f"\n    Grid: {totalColumns}x{totalRows} ({totalTiles} tiles) | Target: {targetFolder}"
  )

  coordinates = itertools.product(range(totalRows), range(totalColumns))
  context     = (mapInfo["id"], mapInfo["version"], resolutionId, tempFolder)
  workerTask  = partial(downloadAndSaveTile, context)

  savedCount   = 0
  emptyCount   = 0
  failedCount  = 0
  omittedTiles = []

  with ThreadPoolExecutor(max_workers = workerCount) as executor:
    for count, (coordinateKey, status) in enumerate(executor.map(workerTask, coordinates), 1):
      if status == "saved":
        savedCount += 1
      elif status == "empty":
        emptyCount += 1
        omittedTiles.append(coordinateKey)
      else:
        failedCount += 1
        omittedTiles.append(coordinateKey)

      if count % 100 == 0 or count == totalTiles:
        print(
          f"    Progress: {count}/{totalTiles} tiles "
          f"| Saved: {savedCount} | Skipped Spacers: {emptyCount}",
          end = "\r"
        )

  # Swap temp folder tiles into the target folder
  for filename in os.listdir(targetFolder):
    if filename.endswith(".png"):
      os.remove(os.path.join(targetFolder, filename))

  for filename in os.listdir(tempFolder):
    os.replace(os.path.join(tempFolder, filename), os.path.join(targetFolder, filename))
  shutil.rmtree(tempFolder, ignore_errors = True)

  # Write metadata descriptor
  metadataPath = os.path.join(targetFolder, "metadata.json")
  with open(metadataPath, "w", encoding = "utf-8") as file:
    json.dump({
      "mapId":        mapInfo["id"],
      "name":         mapInfo["name"],
      "resolution":   resolutionId,
      "tileSize":     tileSize,
      "totalColumns": totalColumns,
      "totalRows":    totalRows,
      "totalWidth":   totalColumns * tileSize,
      "totalHeight":  totalRows    * tileSize,
      "naming":       "{column}x{row}.png",
      "indexing":     "1-based",
      "omittedTiles": omittedTiles,
    }, file, indent = 2)

  print(
    f"\n[✓] Finished {mapInfo['name']}: "
    f"{savedCount} tiles saved, {emptyCount} empty tiles skipped, {failedCount} missing."
  )

  return {
    "mapId":      mapInfo["id"],
    "name":       mapInfo["name"],
    "resolution": resolutionId,
    "folderName": folderName,
    "metadata":   f"./{folderName}/metadata.json",
  }

def discoverMaps(mapIds):
  """Probes specified or all map IDs up to the ceiling in parallel"""
  print("[*] Scanning for available maps...")
  with ThreadPoolExecutor(max_workers = workerCount) as executor:
    discovered = [info for info in executor.map(fetchMapInfo, mapIds) if info]

  for info in discovered:
    print(f"  -> Found Map ID {info['id']}: {info['name']} ({info['width']}x{info['height']})")
  print(f"[*] Discovery completed. Found {len(discovered)} map(s).\n")
  return discovered

def updateIndex(newMaps):
  """Updates index.json of previously exported maps"""
  indexPath = os.path.join(outputDirectory, "index.json")
  maps      = {}

  if os.path.exists(indexPath):
    try:
      with open(indexPath, "r", encoding = "utf-8") as file:
        maps = {m["mapId"]: m for m in json.load(file).get("maps", []) if "mapId" in m}
    except (json.JSONDecodeError, OSError):
      pass

  maps.update({m["mapId"]: m for m in newMaps})
  merged = sorted(maps.values(), key = lambda m: m["mapId"])

  with open(indexPath, "w", encoding = "utf-8") as file:
    json.dump({"totalMaps": len(merged), "maps": merged}, file, indent = 2)

  print(f"\n[*] Generated index at {indexPath}")

def main():
  parser = argparse.ArgumentParser(description = "Download and export Genshin Impact map tiles")
  parser.add_argument("ids", nargs = "*", type = int, metavar = "ID", help = "Map IDs to fetch")
  requestedIds = list(dict.fromkeys(parser.parse_args().ids))

  os.makedirs(outputDirectory, exist_ok = True)
  discoveredMaps = discoverMaps(requestedIds or range(1, mapIdCeiling + 1))
  exportedMaps   = [entry for info in discoveredMaps if (entry := exportMap(info))]

  updateIndex(exportedMaps)
  print("All map exports completed!")

if __name__ == "__main__":
  main()