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

## Tebex + tebexwrapper

Checkout gebruikt dezelfde Tebex-winkel als de FiveM-resource `tebexwrapper`.

1. Zet `TEBEX_SECRET` (= `sv_tebexSecret` in `server.cfg`) in `.env` of Vercel. Lokaal wordt `server.cfg` automatisch gelezen als die env ontbreekt.
2. Optioneel: `TEBEX_PUBLIC_TOKEN` (Tebex Headless) voor basket-API checkout. Zonder token valt de site terug op de Tebex storefront-URL.
3. In Tebex → pakketcommands: `matrixwrapper:sendProduct {id} {packageId} {price} {transaction}` zodat `tebexwrapper` coins/rewards in-game uitkeert (`Config.Redeem`).

Status: `GET /api/store/status`

## Wat werkt

- Home, doneren/webshop UI, wapen skins, leaderboards, regels, privacy & voorwaarden
- Live Tebex-catalogus, recente betalingen en checkout (Discord-login vereist)
- Koppeling met lokale `tebexwrapper` redeem-map
- Winkelwagen (localStorage)
- Admin panel + onderhoudsmodus

## Disclaimer

Amsterdam Roleplay webshop — frontend gebaseerd op een eerdere store-clone.
