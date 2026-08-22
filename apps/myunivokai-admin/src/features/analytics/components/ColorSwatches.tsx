// The swatch renders the stored string as a CSS colour and prints it beside
// itself. If the value is not a colour the browser paints nothing and the text
// still identifies what was stored — which is the failure an operator needs to
// see, rather than a blank chip.
export function ColorSwatches({ colors }: { colors: string[] }) {
  if (colors.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">None recorded.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {colors.map((color) => (
        <span
          key={color}
          className="inline-flex items-center gap-1.5 rounded-md border border-border py-1 pl-1 pr-2"
        >
          <span className="size-4 rounded" style={{ backgroundColor: color }} aria-hidden="true" />
          <span className="font-mono text-xs text-muted-foreground">{color}</span>
        </span>
      ))}
    </div>
  );
}
