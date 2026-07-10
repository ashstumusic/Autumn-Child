#!/bin/bash
cd "$(dirname "$0")"

echo "Building release zips..."

for dir in Audio/*/; do
  name=$(basename "$dir")
  count=$(find "$dir" -maxdepth 1 -name "*.mp3" | wc -l)
  if [ "$count" -gt 0 ]; then
    zip -j -q "Audio/${name}.zip" "$dir"*.mp3
    echo "  ✓ ${name}.zip (${count} tracks)"
  fi
done

echo "Building EPK zip..."
if [ -d "autumn child - Electronic Press Kit" ]; then
  (cd "autumn child - Electronic Press Kit" && zip -r -q "../autumn child - Electronic Press Kit.zip" .)
  echo "  ✓ autumn child - Electronic Press Kit.zip"
fi

echo "Done."
