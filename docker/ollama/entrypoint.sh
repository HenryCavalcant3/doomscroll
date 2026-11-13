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

# Aquece o LLM: na primeira vez depois de subir, carregar o modelo e fazer a primeira geração na GPU
# leva perto de um minuto, e sem isso quem manda a primeira mensagem para uma persona espera esse tempo.
# Só carregar não basta: a primeira geração também é lenta, então manda um prompt do tamanho do chat.
if [ "$ok" = 1 ] && [ -n "${LLM_MODEL:-}" ]; then
  (
    prompt="Responda só com a palavra ok."
    i=0
    while [ $i -lt 40 ]; do prompt="Uma rede social de vídeos curtos, com personas que comentam e conversam. $prompt"; i=$((i + 1)); done
    ollama run "$LLM_MODEL" "$prompt" </dev/null >/dev/null 2>&1 && echo "[ollama] $LLM_MODEL aquecido."
  ) &
fi
wait "$pid"
