import { useState } from "react";
import type { Topic } from "../api";
import { MAX_TOPICS } from "../stages";

interface Props {
  topics: Topic[];
  /** Tópicos sugeridos pela IA: aparecem sempre, mesmo se desmarcados. */
  suggested: string[];
  selected: string[];
  onChange(selected: string[]): void;
}

/** Pílulas de tópico: amarelo = escolhido; "+ tópico" mostra o resto da lista (não cria tópicos). */
export function TopicPicker({ topics, suggested, selected, onChange }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? topics : topics.filter((t) => suggested.includes(t.slug) || selected.includes(t.slug));
  const full = selected.length >= MAX_TOPICS;

  const toggle = (slug: string) =>
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);

  return (
    <div className="pills">
      {visible.map((t) => {
        const on = selected.includes(t.slug);
        return (
          <button
            key={t.slug}
            type="button"
            className="pill"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => toggle(t.slug)}
          >
            {t.name.toLowerCase()}
          </button>
        );
      })}
      {!showAll && visible.length < topics.length && (
        <button type="button" className="pill pill-add" onClick={() => setShowAll(true)}>
          + tópico
        </button>
      )}
    </div>
  );
}
