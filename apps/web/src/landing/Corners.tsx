/** Viewfinder-style corner brackets. `outside` sits them 8px beyond the frame edge. */
const cornerPlacement = {
  outside: ["-left-2 -top-2", "-right-2 -top-2", "-bottom-2 -left-2", "-bottom-2 -right-2"],
  inside: ["left-0 top-0", "right-0 top-0", "bottom-0 left-0", "bottom-0 right-0"],
} as const;
const cornerSides = [
  "border-l-2 border-t-2",
  "border-r-2 border-t-2",
  "border-b-2 border-l-2",
  "border-b-2 border-r-2",
] as const;

export function Corners({
  placement = "outside",
  small = false,
}: {
  placement?: keyof typeof cornerPlacement;
  small?: boolean;
}) {
  return (
    <span aria-hidden="true">
      {cornerSides.map((sides, i) => (
        <span
          key={sides}
          className={`pointer-events-none absolute ${small ? "size-3" : "size-5"} border-0 border-solid border-[#c7d9bc] ${sides} ${cornerPlacement[placement][i]}`}
        />
      ))}
    </span>
  );
}
