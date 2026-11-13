import {
  Heart,
  FileCode2,
  Brain,
  Sparkles,
  BookOpen,
  ShieldCheck,
  Layers3,
  Wallet,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import {
  skillCatalog,
  type SkillId,
} from "../../../../packages/core/src/skills";
import type { Snapshot } from "../server/snapshot";

const icons: Record<SkillId, LucideIcon> = {
  coding: FileCode2,
  intelligence: Brain,
  creativity: Sparkles,
  research: BookOpen,
  testing: ShieldCheck,
  planning: Layers3,
  business: Wallet,
  adaptability: RefreshCw,
};
const number = (value: number) =>
  value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
function Meter({ name, value }: { name: string; value: number }) {
  return (
    <div
      className="progress-meter"
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}
export default function ProgressPanel({
  creature,
}: {
  creature: Snapshot["creature"];
}) {
  return (
    <section className="progress-panel" aria-labelledby="progress-heading">
      <div className="progress-summary">
        <div>
          <h2 id="progress-heading">Benwa’s progress</h2>
          <p>Small wins. Better skills. A little wiser every day.</p>
        </div>
        <div className="happiness-stat">
          <div>
            <span>
              <Heart size={15} /> Happiness
            </span>
            <strong>
              {number(creature.mood)}
              <small>/100</small>
            </strong>
          </div>
          <Meter name="Happiness" value={creature.mood} />
        </div>
      </div>
      <div className="skill-grid">
        {skillCatalog.map(({ id, name, description }) => {
          const Icon = icons[id],
            value = creature.skills[id];
          return (
            <div className="skill-card" key={id} title={description}>
              <div>
                <span>
                  <Icon size={15} />
                  {name}
                </span>
                <strong>
                  {number(value)}
                  <small>/100</small>
                </strong>
              </div>
              <Meter name={name} value={value} />
            </div>
          );
        })}
      </div>
      <p className="progress-note">
        Verified progress builds skills. Relevant failures lower them. New ideas
        build creativity when he turns them into useful work. Ratings reflect
        his recorded work.
      </p>
    </section>
  );
}
