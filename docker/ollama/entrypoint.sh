#!/bin/sh
# Sobe o Ollama e garante que LLM_MODEL e EMBED_MODEL estejam baixados.
# Modelos já presentes não são baixados de novo, então funciona offline depois da primeira vez.
set -u
READY=/tmp/models-ready
rm -f "$READY"

ollama serve &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT

until ollama list >/dev/null 2>&1; do sleep 1; done

has_model() {
  name=$1
  case "$name" in *:*) ;; *) name="$name:latest" ;; esac
  ollama list | awk 'NR>1 {print $1}' | grep -qx "$name"
}

ok=1
for model in ${LLM_MODEL:-} ${EMBED_MODEL:-}; do
  if has_model "$model"; then
    echo "[ollama] $model já está disponível."
  else
    echo "[ollama] baixando $model..."
    if ! ollama pull "$model"; then
      echo "[ollama] AVISO: não foi possível baixar $model (sem internet?)."
      ok=0
    fi
  fi
done

[ "$ok" = 1 ] && touch "$READY" && echo "[ollama] modelos prontos."
wait "$pid"
