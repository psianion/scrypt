export type Choice = "mine" | "hub" | "both";

export function ConflictChunk({ local, remote, choice, onChoose }: { local: string; remote: string; choice: Choice | null; onChoose: (c: Choice) => void; }) {
  return (
    <div className="cc">
      <div className={`cc__box cc__box--hub ${choice === "hub" || choice === "both" ? "is-sel" : choice ? "is-dim" : ""}`}>
        <span className="cc__tab">Hub · para-raid</span>
        <span className="cc__text">{remote}</span>
        <button type="button" className="cc__btn cc__btn--hub" onClick={() => onChoose("hub")}>Take hub</button>
      </div>
      <div className="cc__vs"><span className="cc__hr" /><span className="cc__pill">vs</span><span className="cc__hr" /></div>
      <div className={`cc__box cc__box--mine ${choice === "mine" || choice === "both" ? "is-sel" : choice ? "is-dim" : ""}`}>
        <span className="cc__tab">Yours</span>
        <span className="cc__text">{local}</span>
        <button type="button" className="cc__btn cc__btn--mine" onClick={() => onChoose("mine")}>Keep mine</button>
        <button type="button" className="cc__btn" onClick={() => onChoose("both")}>Keep both</button>
      </div>
    </div>
  );
}
