/** Hook cu STAREA media (Faza 3.3 finalizare) — atașamente + înregistrare voce. Extras din
 *  chat/[id].tsx, logică byte-identică. Depinde de `deliver` (din useChatMessages) + setAttach. */
import { useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { VoiceRecorder } from "../../media/actions";
import { Attachment } from "../../data/mockData";

type Deps = {
  deliver: (plaintext: string, attachment?: Attachment) => Promise<void>;
  setAttach: (v: boolean) => void;
};

export function useMediaSend({ deliver, setAttach }: Deps) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<VoiceRecorder | null>(null);

  async function runAttach(run: () => Promise<Attachment | null>) {
    setAttach(false);
    const a = await run();
    if (a) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await deliver("", a);
    }
  }

  async function toggleVoice() {
    if (!recording) {
      const r = new VoiceRecorder();
      const ok = await r.start();
      if (!ok) return;
      recRef.current = r;
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } else {
      const a = await recRef.current?.stop();
      recRef.current = null;
      setRecording(false);
      if (a) await deliver("", a);
    }
  }

  return { recording, runAttach, toggleVoice };
}
