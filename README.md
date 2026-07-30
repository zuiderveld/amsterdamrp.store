# Groningen Roleplay — lokale clone

Lokale kopie van [groningenrp.store](https://groningenrp.store/) met de originele frontend-assets en mock API-data.

## Starten

```bash
npm install
npm start
```

Open daarna [http://localhost:5173](http://localhost:5173).

## Admin panel

Open [http://localhost:5173/admin](http://localhost:5173/admin).

Alleen Discord-users met role ID `1521182074118082599` krijgen toegang.

Kopieer `.env.example` → `.env` en vul Discord OAuth in:

- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID` (jouw Discord-server)
- Redirect URL in Discord portal: `http://localhost:5173/api/auth/discord/callback`
- Scopes: `identify` + `guilds.members.read`

Lokaal zonder Discord: zet `DEV_ADMIN_BYPASS=1` in `.env`.

In het admin panel kun je o.a.:

- Website in **onderhoud** of **openbaar** zetten
- Server online/max, Discord-leden, banner
- Shop categorieën/pakketten beheren
- Leaderboards & recente betalingen beheren
- Discord/FiveM links wijzigen

## Wat werkt

- Home, doneren/webshop UI, wapen skins, leaderboards, regels, privacy & voorwaarden
- Server status, catalogus, recente betalingen en leaderboards
- Winkelwagen (localStorage)
- Admin panel + onderhoudsmodus

## Wat niet werkt

- Tebex-checkout (echte betalingen) — bewust uitgeschakeld in deze clone

## Disclaimer

Dit project is uitsluitend bedoeld voor leer-/ontwikkeldoeleinden. Merken, logo’s en content blijven eigendom van Groningen Roleplay.
