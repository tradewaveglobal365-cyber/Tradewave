# Tradewave

Fractional real-estate investment platform for the Dubai market.

## Structure

| Path | Stack | Deploys to |
| --- | --- | --- |
| `tradewave-api/` | Express + Prisma + PostgreSQL | Render |
| `tradewave-web/` | Next.js 16 (App Router) | Vercel |

## Local development

Each app is independent. Copy its `.env.example` to `.env` and fill in the values.

```bash
# API — http://localhost:4001
cd tradewave-api && npm install && npm run db:migrate && npm run dev

# Web — http://localhost:3000
cd tradewave-web && npm install && npm run dev
```

## Testing

```bash
cd tradewave-api && npm test
```
