# Open-Data Limitations

The first version deliberately keeps the data plane small and reproducible.

- Source URLs and public dataset availability must be rechecked before any real
  release because open-data catalogs and update cadences change.
- The current seed is a demo snapshot, not a live ETL mirror.
- Reports must preserve limitations from every dataset passport.
- NASA FIRMS integration requires `NASA_FIRMS_MAP_KEY` before live calls.
- Guests are read-only and can only inspect precomputed demo outputs.
- No source may enter the public API unless it is marked `contour=open` and
  passes the gateway checks.
