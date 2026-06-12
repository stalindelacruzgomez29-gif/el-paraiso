#!/bin/zsh
# ──────────────────────────────────────────────────────────
#  EL PARAÍSO · Publicar la última versión en internet
#  Doble clic en este archivo y listo.
# ──────────────────────────────────────────────────────────
cd "$(dirname "$0")"
export PATH="$HOME/herramientas/node/bin:$PATH"

echo "🌴 Publicando El Paraíso en Vercel..."
vercel --prod --yes

echo ""
echo "✅ ¡Publicado! Cierra esta ventana cuando quieras."
read -k 1 -s
