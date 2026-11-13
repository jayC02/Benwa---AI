import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { Pause, Play, House as HouseIcon } from "lucide-react";
import type { Snapshot } from "../server/snapshot";
import {
  ROOM_IDS,
  ROOMS,
  selectScene,
  type RoomId,
  type WorldTarget,
} from "../world/rooms";
import {
  detectReactions,
  type Reaction,
  type ReactionInput,
} from "../world/reactions";
import {
  createDirector,
  currentRoom,
  enqueue,
  setTarget,
  tick,
  type DirectorState,
} from "../world/director";
import { poseAt, type Prop } from "../world/animations";
import { loadRig, type BenwaRig } from "../world/rig";
import { buildHouse } from "../world/house";
import { cameraFrame, defaultMode, type CameraMode } from "../world/camera";
import { WORK_SPOT } from "../world/layout";
import { BADGE_LABEL, outcomeBadge } from "../world/progress";
import { activityWords, ago, worldInput } from "./worldText";

/** Extra yaw while doing a room's job, so he turns toward its props (0 faces the viewer). */
const WORK_YAW: Record<RoomId, number> = {
  hall: 0.9,
  study: 2.4,
  workshop: 2.5,
  library: 0.3,
  planning: 3.0,
  journal: 2.8,
  bedroom: 0,
};
const PROP_EMOJI: Record<Prop, string> = {
  none: "",
  book: "📖",
  letter: "✉️",
  pencil: "✏️",
  note: "📌",
  question: "❓",
  zzz: "💤",
  smoke: "💨",
  coins: "🪙",
};
const CLIMB_Z = -1.25;

function reactionInput(s: Snapshot): ReactionInput {
  return {
    actions: s.actions.map((a) => ({
      id: a.id,
      status: a.status,
      outcome: a.outcome,
    })),
    milestones: s.projects.flatMap((p) =>
      p.milestones.map((m) => ({ id: m.id, simulated: m.simulated })),
    ),
    netMinor: s.finance.net,
  };
}
type Zoom = RoomId | "house" | null;

export default function World({
  s,
  onRoom,
}: {
  s: Snapshot;
  /** Called when the room Benwa is standing in changes, so panels can agree with the house. */
  onRoom?: (room: RoomId) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    bubble = useRef<HTMLDivElement>(null),
    prop = useRef<HTMLSpanElement>(null),
    labels = useRef<Partial<Record<RoomId, HTMLButtonElement | null>>>({}),
    roomRef = useRef<RoomId | null>(null),
    targetRef = useRef<WorldTarget | null>(null),
    reactionsRef = useRef<Reaction[]>([]),
    prevReaction = useRef<ReactionInput | null>(null),
    zoomRef = useRef<Zoom>(null),
    onRoomRef = useRef(onRoom),
    paused = useRef(false);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading"),
    [retry, setRetry] = useState(0),
    [motionPaused, setMotionPaused] = useState(false),
    [zoom, setZoom] = useState<Zoom>(null),
    [narrow, setNarrow] = useState(false);

  const target = useMemo(
    () => selectScene(worldInput(s, roomRef.current)),
    [s],
  );
  targetRef.current = target;
  zoomRef.current = zoom;
  onRoomRef.current = onRoom;

  useEffect(() => {
    const next = reactionInput(s);
    reactionsRef.current.push(...detectReactions(prevReaction.current, next));
    prevReaction.current = next;
  }, [s]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setLoad("error");
      return;
    }
    setLoad("loading");
    let disposed = false,
      frame = 0,
      visible = true,
      rig: BenwaRig | undefined,
      announced = false;
    const controller = new AbortController();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    scene.add(new THREE.HemisphereLight(0xf6faff, 0xa7b3a0, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    sun.position.set(-6, 16, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -12,
      right: 12,
      top: 12,
      bottom: -4,
      near: 1,
      far: 50,
    });
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe4ff, 0.9);
    fill.position.set(10, 6, 12);
    scene.add(fill);
    for (const f of [0, 1, 2]) {
      const lamp = new THREE.PointLight(0xffd9a8, 6, 9, 1.6);
      lamp.position.set(2.5, f * 3 + 2.5, 1);
      scene.add(lamp);
    }
    const house = buildHouse();
    scene.add(house.group);

    let director: DirectorState | null = null;
    const view = { x: 0, y: 5, h: 12, ready: false };
    let z = WORK_SPOT.study.z;

    void loadRig("/models/benwa.glb", controller.signal)
      .then((loaded) => {
        if (disposed) return loaded.dispose();
        rig = loaded;
        scene.add(rig.object);
      })
      .catch((e: unknown) => {
        if (!disposed && !(e instanceof Error && e.name === "AbortError"))
          setLoad("error");
      });

    const size = { w: 1, h: 1 };
    const resize = () => {
      size.w = Math.max(1, element.clientWidth);
      size.h = Math.max(1, element.clientHeight);
      renderer.setSize(size.w, size.h);
      setNarrow(size.w / size.h < 0.9);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduced.matches;
    const onReduced = () => {
      reduce = reduced.matches;
    };
    reduced.addEventListener("change", onReduced);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    intersection.observe(element);
    const contextLost = (e: Event) => {
      e.preventDefault();
      setLoad("error");
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    const project = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return { x: ((p.x + 1) / 2) * size.w, y: ((1 - p.y) / 2) * size.h };
    };
    let last = performance.now(),
      clock = 0;
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (document.hidden || !visible) {
        reactionsRef.current = []; // nobody is watching: don't save up a stale show
        return;
      }
      const moving = !reduce && !paused.current;
      if (moving) clock += dt;
      const t = targetRef.current!;
      if (!director) director = createDirector(t, clock);
      if (moving) director = setTarget(director, t, clock);
      else if (
        director.target.room !== t.room ||
        director.target.activity !== t.activity
      )
        director = createDirector(t, clock); // motion off: snap instead of walking
      if (reactionsRef.current.length) {
        if (moving) director = enqueue(director, reactionsRef.current);
        reactionsRef.current = [];
      }
      const step = tick(director, moving ? dt : 0, clock);
      director = step.state;
      const room = currentRoom(director);
      if (room && room !== roomRef.current) {
        roomRef.current = room;
        onRoomRef.current?.(room);
      }
      const pose = poseAt(step.anim, moving ? step.animTime : 0);
      const walking = director.path.length > 0;
      const zGoal =
        director.path[0]?.mode === "climb" ? CLIMB_Z : WORK_SPOT.study.z;
      z += (zGoal - z) * (moving ? Math.min(1, dt * 6) : 1);
      if (rig) {
        rig.object.position.set(director.x, director.y + 0.16, z);
        const workYaw =
          !walking && step.anim !== "walk" && room && t.activity === "work"
            ? WORK_YAW[room]
            : 0;
        rig.object.rotation.y = director.facing + workYaw;
        rig.apply(pose);
      }
      house.setRoomHighlight(room);
      house.update(clock);

      const aspect = size.w / size.h;
      const zoomed = zoomRef.current;
      const mode: CameraMode =
        zoomed === "house"
          ? { kind: "house" }
          : zoomed
            ? { kind: "room", room: zoomed }
            : defaultMode(aspect, room ?? roomRef.current ?? t.room);
      const goal = cameraFrame(mode, aspect, { x: director.x, y: director.y });
      const ease = view.ready && moving ? Math.min(1, dt * 3) : 1;
      view.x += (goal.centre.x - view.x) * ease;
      view.y += (goal.centre.y - view.y) * ease;
      view.h += (goal.viewHeight - view.h) * ease;
      view.ready = true;
      camera.left = (-view.h * aspect) / 2;
      camera.right = (view.h * aspect) / 2;
      camera.top = view.h / 2;
      camera.bottom = -view.h / 2;
      camera.position.set(view.x + 2, view.y + 3, 30);
      camera.lookAt(view.x, view.y, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      renderer.render(scene, camera);

      if (rig && bubble.current) {
        const head = project(rig.headTop());
        bubble.current.style.transform = `translate(${head.x}px, ${head.y}px) translate(-50%, -100%)`;
        bubble.current.dataset.placed = "true";
        if (prop.current) {
          prop.current.textContent = PROP_EMOJI[pose.prop];
          prop.current.style.transform = `translate(${head.x + 22}px, ${head.y + 30}px)`;
        }
      }
      for (const id of ROOM_IDS) {
        const el = labels.current[id];
        if (!el) continue;
        const p = project(house.labelAnchor[id]);
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        const inside = p.x >= 0 && p.x <= size.w && p.y >= 0 && p.y <= size.h;
        el.style.visibility = inside ? "" : "hidden";
        el.inert = !inside;
      }
      if (rig && !announced) {
        announced = true;
        setLoad("ready");
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      reduced.removeEventListener("change", onReduced);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      rig?.dispose();
      house.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [retry]);

  const room = ROOMS[target.room];
  const words = activityWords(target);
  const sleeping = target.activity === "sleep";
  const bubbleText = sleeping ? "z z z" : s.creature.thought;
  const roomZoom = zoom && zoom !== "house" ? zoom : null;
  const history = roomZoom ? (s.roomHistory[roomZoom] ?? []) : [];
  // On phones the default view follows his room, so "Whole house" must be an explicit mode.
  const showWholeHouse = roomZoom !== null || (narrow && zoom !== "house");
  return (
    <div className={`world ${roomZoom ? "zoomed" : ""}`}>
      <div
        className="world-stage"
        ref={host}
        role="img"
        data-model-state={load}
        data-room={target.room}
        data-activity={target.activity}
        aria-label={`Benwa, your cream-coloured sprout creature, in the ${room.name.toLowerCase()}, ${words}. Mood ${Math.round(s.creature.mood)}. Energy ${Math.round(s.creature.energy)}.`}
      >
        <div
          className={`thought-bubble ${target.activity}`}
          data-testid="thought-bubble"
          ref={bubble}
          title={s.creature.thought}
        >
          <span className="bubble-text">
            {target.activity === "ponder" && (
              <span className="dots" aria-hidden="true">
                …{" "}
              </span>
            )}
            {bubbleText}
          </span>
        </div>
        <span className="pose-prop" ref={prop} aria-hidden="true" />
      </div>
      <div className="world-labels">
        {ROOM_IDS.map((id) => (
          <button
            key={id}
            ref={(el) => {
              labels.current[id] = el;
            }}
            className={`room-label ${id === target.room ? "here" : ""} ${roomZoom === id ? "open" : ""}`}
            style={{ "--room": ROOMS[id].colour } as CSSProperties}
            aria-label={`Look in the ${ROOMS[id].name}`}
            aria-pressed={roomZoom === id}
            onClick={() => setZoom(roomZoom === id ? null : id)}
          >
            {ROOMS[id].name}
          </button>
        ))}
      </div>
      <div className="world-status">
        <span
          className={`live-dot ${s.workerOnline && s.creature.status === "RUNNING" ? "on" : ""}`}
        />
        <strong>{room.name}</strong>
        <span>· {words}</span>
        {target.label && <span className="world-flag">{target.label}</span>}
      </div>
      {load === "loading" && (
        <div className="model-message" role="status">
          Benwa is coming into view…
        </div>
      )}
      {load === "error" && (
        <div className="model-message" role="status">
          <strong>Benwa is still here.</strong>
          <span>
            The 3D house couldn’t load on this device. He’s in the{" "}
            {room.name.toLowerCase()}, {words}.
          </span>
          <button onClick={() => setRetry((n) => n + 1)}>
            Try the 3D view again
          </button>
        </div>
      )}
      <div className="world-controls">
        {showWholeHouse && (
          <button
            className="whole-house"
            onClick={() => setZoom(narrow ? "house" : null)}
          >
            <HouseIcon size={13} /> Whole house
          </button>
        )}
        {narrow && zoom === "house" && (
          <button className="whole-house" onClick={() => setZoom(null)}>
            Follow Benwa
          </button>
        )}
        <button
          aria-label={
            motionPaused
              ? "Resume creature animation"
              : "Pause creature animation"
          }
          onClick={() => {
            paused.current = !paused.current;
            setMotionPaused(paused.current);
          }}
        >
          {motionPaused ? <Play size={12} /> : <Pause size={12} />}
        </button>
      </div>
      {roomZoom && (
        <section
          className="room-panel"
          aria-label={`What he's done in the ${ROOMS[roomZoom].name}`}
        >
          <h3>What he’s done in the {ROOMS[roomZoom].name.toLowerCase()}</h3>
          {history.length ? (
            <ul>
              {history.map((a) => {
                const badge = outcomeBadge(a);
                return (
                  <li key={a.id}>
                    <span className={`badge badge-${badge}`}>
                      {BADGE_LABEL[badge]}
                    </span>
                    <span className="room-panel-text">
                      {a.outcome?.summary ?? a.intention}
                    </span>
                    <time>{ago(a.createdAt)}</time>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="room-panel-empty">Nothing here yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
