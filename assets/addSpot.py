import io
import os
import re
import json
import requests
from PIL import Image, ImageOps

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
SPOTS_DIR  = os.path.join(BASE_DIR, "genshin_spots")
INDEX_PATH = os.path.join(SPOTS_DIR, "index.json")
ISSUE_BODY = os.environ.get("ISSUE_BODY", "")

def parse_issue():
  map_id_match = re.search(r"### Map ID\s+([0-9]+)",                                 ISSUE_BODY)
  x_match      = re.search(r"### Coordinate X\s+([0-9.-]+)",                         ISSUE_BODY)
  y_match      = re.search(r"### Coordinate Y\s+([0-9.-]+)",                         ISSUE_BODY)
  img_match    = re.search(r"(?:!\[.*?\]\(|<img.*?src=[\"'])(https?://[^\s\"'\)]+)", ISSUE_BODY)

  if not all([map_id_match, x_match, y_match, img_match]):
    raise ValueError("Missing required fields in issue body.")

  return {
    "mapId": int(map_id_match.group(1)),
    "x":     float(x_match.group(1)),
    "y":     float(y_match.group(1)),
    "url":   img_match.group(1),
  }

def main():
  if not os.path.exists(INDEX_PATH):
    raise FileNotFoundError(f"Missing index file: {INDEX_PATH}")

  with open(INDEX_PATH, "r", encoding = "utf-8") as f:
    data = json.load(f)

  if "spotLocation" not in data:
    raise KeyError("Missing 'spotLocation' in index.json")

  spot_location = data["spotLocation"]
  images_dir    = os.path.normpath(os.path.join(SPOTS_DIR, spot_location))
  os.makedirs(images_dir, exist_ok = True)

  spot_data    = parse_issue()
  spots        = data.setdefault("spots", [])
  existing_ids = [s.get("id", 0) for s in spots if isinstance(s, dict)]
  next_id      = max(existing_ids, default = -1) + 1

  image_filename = f"{next_id}.png"
  image_path     = os.path.join(images_dir, image_filename)

  response = requests.get(spot_data["url"], timeout = 30)
  response.raise_for_status()

  with Image.open(io.BytesIO(response.content)) as img:
    img         = ImageOps.exif_transpose(img)
    target_mode = "RGBA" if img.has_transparency_data else "RGB"
    if img.mode != target_mode:
      img = img.convert(target_mode)
    img.save(image_path, format = "PNG")

  if spots and isinstance(spots[0], dict) and "/" in spots[0].get("image", ""):
    image_entry = f"{spot_location.rstrip('/')}/{image_filename}"
  else:
    image_entry = image_filename

  new_spot = {
    "id":     next_id,
    "mapId":  spot_data["mapId"],
    "coords": {
      "x": spot_data["x"],
      "y": spot_data["y"],
    },
    "image": image_entry,
  }

  spots.append(new_spot)

  if "totalSpots" in data:
    data["totalSpots"] = len(spots)

  with open(INDEX_PATH, "w", encoding = "utf-8") as f:
    json.dump(data, f, indent = 2)

  print(f"Successfully added spot #{next_id} -> {image_path}")

if __name__ == "__main__":
  main()