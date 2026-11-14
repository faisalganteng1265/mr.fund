import { RefreshCw } from "lucide-react";
import { ModalFrame } from "./ModalFrame";
import type { DataState } from "./source/types";

interface Props {
  dataState: DataState;
  selectDataState: (state: DataState) => void;
  comfort: string;
  setComfort: (value: string) => void;
  watcherOnline: boolean;
  setWatcherOnline: (online: boolean) => void;
  reset: () => void;
  close: () => void;
}
export function SettingsDialog({
  dataState,
  selectDataState,
  comfort,
  setComfort,
  watcherOnline,
  setWatcherOnline,
  reset,
  close,
}: Props) {
  return (
    <ModalFrame eyebrow="BEHIND THE SCENES" title="Make the demo yours." close={() => close()}>
      <label className="form-field flex flex-col gap-[8px] mt-[21px] min-w-0 [&>span]:text-[10px] [&>span]:font-bold [&>span]:flex [&>span]:justify-between [&>span_small]:text-[8px] [&>span_small]:font-normal [&>span_small]:text-[#a2a4a5] [&_input]:p-[12px] [&_input]:bg-[#1c1e1f] [&_input]:[border:1px_solid_#313334] [&_input]:rounded-[7px] [&_input]:text-[12px] [&_input]:text-[var(--ink)] [&_input]:w-full [&_input]:min-w-0 [&_select]:p-[12px] [&_select]:bg-[#1c1e1f] [&_select]:[border:1px_solid_#313334] [&_select]:rounded-[7px] [&_select]:text-[12px] [&_select]:text-[var(--ink)] [&_select]:w-full [&_select]:min-w-0 [&>small]:text-[8px] [&>small]:leading-[1.5] [&>small]:text-[#a2a4a5] max-[620px]:[&>span]:text-[9px] max-[620px]:[&_input]:text-[11px] max-[620px]:[&_input]:p-[11px_9px] max-[620px]:[&_select]:text-[11px] max-[620px]:[&_select]:p-[11px_9px] max-[620px]:[&>small]:text-[7px]">
        <span>Position data state</span>
        <select
          value={dataState}
          onChange={(e) => {
            selectDataState(e.target.value as DataState);
          }}
        >
          <option value="fresh">Fresh — ready to explore</option>
          <option value="loading">Loading — input in flight</option>
          <option value="stale">Stale — advice and execution blocked</option>
          <option value="empty">Empty — no lending position</option>
          <option value="error">Error — simulated RPC failure</option>
        </select>
      </label>
      <label className="form-field flex flex-col gap-[8px] mt-[21px] min-w-0 [&>span]:text-[10px] [&>span]:font-bold [&>span]:flex [&>span]:justify-between [&>span_small]:text-[8px] [&>span_small]:font-normal [&>span_small]:text-[#a2a4a5] [&_input]:p-[12px] [&_input]:bg-[#1c1e1f] [&_input]:[border:1px_solid_#313334] [&_input]:rounded-[7px] [&_input]:text-[12px] [&_input]:text-[var(--ink)] [&_input]:w-full [&_input]:min-w-0 [&_select]:p-[12px] [&_select]:bg-[#1c1e1f] [&_select]:[border:1px_solid_#313334] [&_select]:rounded-[7px] [&_select]:text-[12px] [&_select]:text-[var(--ink)] [&_select]:w-full [&_select]:min-w-0 [&>small]:text-[8px] [&>small]:leading-[1.5] [&>small]:text-[#a2a4a5] max-[620px]:[&>span]:text-[9px] max-[620px]:[&_input]:text-[11px] max-[620px]:[&_input]:p-[11px_9px] max-[620px]:[&_select]:text-[11px] max-[620px]:[&_select]:p-[11px_9px] max-[620px]:[&>small]:text-[7px]">
        <span>Your comfort line (%)</span>
        <input
          type="number"
          min="105"
          max="1000"
          value={comfort}
          onChange={(e) => setComfort(e.target.value)}
        />
        <small>Mr.Fund becomes concerned below this line. This is not a guarantee.</small>
      </label>
      <label className="switch-row flex items-center justify-between m-[25px_0] [&_b]:text-[11px] [&_small]:block [&_small]:text-[9px] [&_small]:text-[#a2a4a5] [&_small]:mt-[5px] [&_input]:w-[19px] [&_input]:h-[19px] [&_input]:[accent-color:var(--blue)]">
        <span>
          <b>Watcher online</b>
          <small>Simulate an offline Guardian watcher</small>
        </span>
        <input
          type="checkbox"
          checked={watcherOnline}
          onChange={(e) => setWatcherOnline(e.target.checked)}
        />
      </label>
      <button
        type="button"
        className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40] full-width w-full"
        onClick={reset}
      >
        <RefreshCw size={16} />
        Reset all demo activity
      </button>
      <p className="fine-print text-[9px] leading-[1.8] text-[#a2a4a5] mt-[18px]! block [&>svg]:[vertical-align:middle] [&>svg]:mr-[5px]">
        Settings affect this tab's demo session only. Reloading starts a fresh session.
      </p>
    </ModalFrame>
  );
}
