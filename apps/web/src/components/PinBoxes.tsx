import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

export const PIN_LENGTH = 6;

/**
 * PIN em 6 caixas de um número (docs/acabamento/telas/entrada.html). Digitar avança, apagar numa
 * caixa vazia volta, e colar espalha os números a partir da caixa onde se colou.
 */
export function PinBoxes({ value, onChange, disabled }: { value: string; onChange(pin: string): void; disabled?: boolean }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: PIN_LENGTH }, (_, i) => value[i] ?? "");
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(PIN_LENGTH - 1, i))]?.focus();

  /** Escreve números a partir da caixa `i` (sem deixar buraco antes) e leva o foco para a próxima. */
  function put(i: number, typed: string) {
    const nums = typed.replace(/\D/g, "");
    if (!nums) return;
    const at = Math.min(i, value.length);
    const next = [...digits];
    for (let k = 0; k < nums.length && at + k < PIN_LENGTH; k++) next[at + k] = nums[k]!;
    onChange(next.join("").slice(0, PIN_LENGTH));
    focus(at + nums.length);
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      onChange(value.slice(0, i - 1));
      focus(i - 1);
    } else if (e.key === "ArrowLeft") focus(i - 1);
    else if (e.key === "ArrowRight") focus(i + 1);
  }

  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    put(i, e.clipboardData.getData("text"));
  }

  return (
    <div className="pin-boxes">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="pin-box"
          aria-label={`Número ${i + 1} do PIN`}
          type="password"
          inputMode="numeric"
          autoComplete={i === 0 ? "current-password" : "off"}
          maxLength={PIN_LENGTH}
          value={d}
          disabled={disabled}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            // Apagou o número da caixa: corta o PIN dali para frente.
            if (!e.target.value) onChange(value.slice(0, i));
            // Um número digitado ao lado do que já estava na caixa: fica só o novo.
            else put(i, typed.length === 2 && d && typed.includes(d) ? typed.replace(d, "") : typed);
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
