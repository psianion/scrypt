export type Choice = "mine" | "hub" | "both";

export function ConflictChunk({ index, local, remote, choice, onChoose }: { index: number; local: string; remote: string; choice: Choice | null; onChoose: (c: Choice) => void; }) {
  // An empty side is a deletion (this side removed these lines), not blank text.
  const remoteDeletes = remote === "";
  const localDeletes = local === "";
  // Toggle buttons use aria-pressed (keeping their implicit button role) inside
  // a labelled group, so the selection is announced to assistive tech and each
  // box is reachable by keyboard. (F18)
  return (
    <div className="cc" role="group" aria-label={`Conflict ${index}: choose which version to keep`}>
      <div className={`cc__box cc__box--hub ${choice === "hub" || choice === "both" ? "is-sel" : choice ? "is-dim" : ""}`}>
        <span className="cc__tab">Hub · para-raid</span>
        {remoteDeletes
          ? <span className="cc__text cc__text--del">(this side removes these lines)</span>
          : <span className="cc__text">{remote}</span>}
        <button type="button" aria-pressed={choice === "hub"} className="cc__btn cc__btn--hub" onClick={() => onChoose("hub")}>Take hub</button>
      </div>
      <div className="cc__vs"><span className="cc__hr" /><span className="cc__pill">vs</span><span className="cc__hr" /></div>
      <div className={`cc__box cc__box--mine ${choice === "mine" || choice === "both" ? "is-sel" : choice ? "is-dim" : ""}`}>
        <span className="cc__tab">Yours</span>
        {localDeletes
          ? <span className="cc__text cc__text--del">(this side removes these lines)</span>
          : <span className="cc__text">{local}</span>}
        <button type="button" aria-pressed={choice === "mine"} className="cc__btn cc__btn--mine" onClick={() => onChoose("mine")}>Keep mine</button>
        <button type="button" aria-pressed={choice === "both"} className="cc__btn" title="Keeps both versions: yours first, then the hub's, in document order." onClick={() => onChoose("both")}>Keep both <span className="cc__order">(yours, then hub)</span></button>
      </div>
    </div>
  );
}
