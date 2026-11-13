import {
  BookOpen,
  Bed,
  FileCode2,
  Mail,
  NotebookPen,
  StickyNote,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Snapshot } from "../server/snapshot";
import type { RoomId, WorldInput, WorldTarget } from "../world/rooms";

export const ROOM_ICON: Record<RoomId, LucideIcon> = {
  hall: Mail,
  study: FileCode2,
  workshop: Wrench,
  library: BookOpen,
  planning: StickyNote,
  journal: NotebookPen,
  bedroom: Bed,
};

const WORK_WORDS: Record<RoomId, string> = {
  hall: "posting a letter",
  study: "typing at his computer",
  workshop: "tinkering with a machine",
  library: "reading",
  planning: "pinning plans to the board",
  journal: "writing in his journal",
  bedroom: "sleeping",
};
const ACTIVITY_WORDS = {
  ponder: "thinking about what to do next",
  sleep: "asleep",
  sit: "sitting quietly",
  wait: "waiting for you",
  confused: "a little confused",
} as const;

export function activityWords(target: WorldTarget) {
  return target.activity === "work"
    ? WORK_WORDS[target.room]
    : ACTIVITY_WORDS[target.activity];
}

export function worldInput(
  s: Snapshot,
  previousRoom: RoomId | null,
): WorldInput {
  const latest = s.actions[0];
  return {
    status: s.creature.status,
    workerOnline: s.workerOnline,
    cycle: s.cycle ? { id: s.cycle.id, stage: s.cycle.stage } : null,
    latestAction: latest
      ? { cycleId: latest.cycleId, tool: latest.tool, status: latest.status }
      : null,
    pendingApprovals: s.approvals.filter((a) => a.status === "PENDING").length,
    openAssistance: s.assistance.length,
    previousRoom,
  };
}

export const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes} min ago`
      : minutes < 60 * 48
        ? `${Math.round(minutes / 60)} h ago`
        : `${Math.round(minutes / 1440)} days ago`;
};
