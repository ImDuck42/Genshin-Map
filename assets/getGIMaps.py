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

# Spacer color thresholds --- WILL MAKE ISSUES
maxRed   = 32
maxGreen = 53
maxBlue  = 74

session = requests.Session()
adapter = requests.adapters.HTTPAdapter(pool_connections = 64, pool_maxsize = 64, max_retries = 3)
session.mount("https://", adapter)
session.mount("http://",  adapter)

def sanitizeFilename(name):
  return re.sub(r'[\\/*?:"<>|]', "", name).strip().replace(" ", "_")

def buildTileUrl(mapId, version, column, row, resolutionId):
  return f"{tileCdn}/{mapId}/{version}/{column}_{row}_{resolutionId}.webp"

def fetchMapInfo(mapId):
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
  """Probes CDN with multi-point sampling to find highest resolution"""
  mapId, version = mapInfo["id"], mapInfo["version"]

  for resolutionId, step in resolutions:
    totalColumns = math.ceil(mapInfo["width"]  / step)
    totalRows    = math.ceil(mapInfo["height"] / step)

    samples = (
      ( totalColumns      // 2,  totalRows      // 2),
      ( totalColumns      // 3,  totalRows      // 3),
      ((totalColumns * 2) // 3, (totalRows * 2) // 3),
      ( totalColumns      // 2,  totalRows      // 3),
      ( totalColumns      // 3,  totalRows      // 2),
    )

    if any(tileExists(buildTileUrl(mapId, version, column, row, resolutionId)) for column, row in samples if column < totalColumns and row < totalRows):
      return resolutionId, step

  return None

def applyTransparencyFilter(rawImageBytes):
  """Filters spacer tiles"""
  image  = Image.open(io.BytesIO(rawImageBytes)).convert("RGBA")
  pixels = np.array(image)

  red   = pixels[:, :, 0]
  green = pixels[:, :, 1]
  blue  = pixels[:, :, 2]

  isSpacer = (
    (red <= maxRed)
    & (green <= maxGreen)
    & (blue  <= maxBlue)
    & (blue  >= red + 4)
    & (blue.astype(np.int16) * 4 >= green.astype(np.int16) * 3)
  )

  if np.all(isSpacer):
    return None, True

  if not np.any(isSpacer):
    return image, False

  pixels[isSpacer, 3] = 0
  return Image.fromarray(pixels, mode = "RGBA"), False

def downloadAndSaveTile(context, coordinate):
  mapId, version, resolutionId, stagingFolder = context
  row, column                                 = coordinate
  coordinateKey                               = f"{column + 1}x{row + 1}"
  tileFilePath                                = os.path.join(stagingFolder, f"{coordinateKey}.png")

  try:
    response = session.get(buildTileUrl(mapId, version, column, row, resolutionId), timeout = 15)
    if response.status_code in (403, 404):
      return coordinateKey, "missing"
    response.raise_for_status()

    tileImage, isEmpty = applyTransparencyFilter(response.content)
    if isEmpty:
      return coordinateKey, "empty"

    tileImage.save(tileFilePath, format = "PNG", compress_level = 0)
    return coordinateKey, "saved"

  except (requests.RequestException, OSError):
    return coordinateKey, "error"

def exportMap(mapInfo):
  resolution = getBestResolution(mapInfo)
  if not resolution:
    print(f"[-] No valid tiles found for {mapInfo['name']}")
    return None

  resolutionId, step = resolution
  totalColumns       = math.ceil(mapInfo["width"]  / step)
  totalRows          = math.ceil(mapInfo["height"] / step)
  totalTiles         = totalColumns * totalRows

  folderName    = f"{mapInfo['id']}_{sanitizeFilename(mapInfo['name'])}_{resolutionId}"
  targetFolder  = os.path.join(outputDirectory, folderName)
  stagingFolder = f"{targetFolder}.tmp"
  backupFolder  = f"{targetFolder}.bak"

  shutil.rmtree(stagingFolder, ignore_errors = True)
  os.makedirs(stagingFolder, exist_ok = True)

  print(
    f"\n[+] Exporting: {mapInfo['name']} (ID: {mapInfo['id']}) | Res: {resolutionId}"
    f"\n    Grid: {totalColumns}x{totalRows} ({totalTiles} tiles) | Target: {targetFolder}"
  )

  coordinates = itertools.product(range(totalRows), range(totalColumns))
  context     = (mapInfo["id"], mapInfo["version"], resolutionId, stagingFolder)
  workerTask  = partial(downloadAndSaveTile, context)

  savedCount   = 0
  emptyCount   = 0
  missingCount = 0
  errorCount   = 0
  omittedTiles = []

  try:
    with ThreadPoolExecutor(max_workers = workerCount) as executor:
      for count, (coordinateKey, status) in enumerate(executor.map(workerTask, coordinates), 1):
        if status == "saved":
          savedCount += 1
        elif status == "error":
          errorCount += 1
        else:
          omittedTiles.append(coordinateKey)
          if status == "empty":
            emptyCount += 1
          else:
            missingCount += 1

        if count % 100 == 0 or count == totalTiles:
          print(f"    Progress: {count}/{totalTiles} tiles | Saved: {savedCount} | Skipped: {emptyCount}", end = "\r")

    if errorCount > 0 or savedCount == 0:
      print(f"\n[!] Aborting {mapInfo['name']}: {errorCount} download error(s), {savedCount} saved. Existing files preserved.")
      return None

    with open(os.path.join(stagingFolder, "metadata.json"), "w", encoding = "utf-8") as file:
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

    shutil.rmtree(backupFolder, ignore_errors = True)
    if os.path.exists(targetFolder):
      os.replace(targetFolder, backupFolder)
    os.replace(stagingFolder, targetFolder)
    shutil.rmtree(backupFolder, ignore_errors = True)

    print(f"\n[✓] Finished {mapInfo['name']}: {savedCount} saved, {emptyCount} empty, {missingCount} missing.")
    return {
      "mapId":      mapInfo["id"],
      "name":       mapInfo["name"],
      "resolution": resolutionId,
      "folderName": folderName,
      "metadata":   f"./{folderName}/metadata.json",
    }
  finally:
    shutil.rmtree(stagingFolder, ignore_errors = True)

def discoverMaps(mapIds):
  print("[*] Scanning for available maps...")
  with ThreadPoolExecutor(max_workers = workerCount) as executor:
    discovered = [info for info in executor.map(fetchMapInfo, mapIds) if info]

  for info in discovered:
    print(f"  -> Found Map ID {info['id']}: {info['name']} ({info['width']}x{info['height']})")
  print(f"[*] Discovery completed. Found {len(discovered)} map(s).\n")
  return discovered

def updateIndex(newMaps):
  if not newMaps:
    return

  indexPath = os.path.join(outputDirectory, "index.json")
  maps      = {}

  if os.path.exists(indexPath):
    with open(indexPath, "r", encoding = "utf-8") as file:
      maps = {mapEntry["mapId"]: mapEntry for mapEntry in json.load(file).get("maps", []) if "mapId" in mapEntry}

  maps.update({mapEntry["mapId"]: mapEntry for mapEntry in newMaps})
  merged = sorted(maps.values(), key = lambda mapEntry: mapEntry["mapId"])

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