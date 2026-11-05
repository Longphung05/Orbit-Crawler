Sanitized, invented Instagram export fixtures (§12: fake users only). Shapes mirror real exports:

- `modern/`: 2024+ layout (`connections/followers_and_following/`), following.json uses `title`
  and `/_u/` hrefs with no `value`; includes a pending request, close friends, an unknown file.
- `classic/`: 2021–2023 layout, followers split into parts, one wrapped in `relationships_followers`.
- `legacy/`: pre-2021 `connections.json` (username → ISO date maps).
- `html/`: an HTML-format export, which Orbit must reject with guidance.
