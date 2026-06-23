import { GenerationStats, StageUsage } from '../types';

// Stage keys → short viewer labels.
// Keep in sync with the `displayLabel` fields on stages[] in packages/cli/index.js.
// New stories embed displayLabel directly in generation.stages; this map is the
// fallback for older stories that predate that field.
const STAGE_LABELS: Record<string, string> = {
  index: 'Index',
  exploration: 'Exploration',
  outline: 'Outline',
  excerpts: 'Excerpts',
  verification: 'Verification',
  explanations: 'Explanations',
  assemble: 'Assembly',
};

const fmt = (n: number | null | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—';

const fmtCost = (n: number | null | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(n < 1 ? 4 : 2)}` : '—';

function stageLabel(s: { key: string; displayLabel?: string }): string {
  return s.displayLabel ?? STAGE_LABELS[s.key] ?? s.key;
}

/**
 * Per-stage model + token usage, shown on the overview (first) chapter.
 * Input and output tokens are shown in separate columns; cost column appears only
 * when at least one stage reported a cost.
 */
export default function GenerationStatsPanel({ generation }: { generation: GenerationStats }) {
  if (!generation?.stages?.length) return null;

  const totals = generation.totals ?? null;
  const anyCost = totals?.costUsd != null || generation.stages.some(s => s.costUsd != null);
  const parseErrors = generation.parseErrors ?? [];

  return (
    <section className="gen-stats" aria-label="Generation details">
      <h3 className="gen-stats-title">How this story was generated</h3>
      {parseErrors.length > 0 && (
        <p className="gen-stats-warn">
          Usage data unavailable for: {parseErrors.map(k => stageLabel(generation.stages.find(s => s.key === k) ?? { key: k })).join(', ')}
          {' '}(runner output format may have changed).
        </p>
      )}
      <div className="gen-stats-scroll">
        <table className="gen-stats-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Model</th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              {anyCost && <th className="num">Cost</th>}
            </tr>
          </thead>
          <tbody>
            {generation.stages.map(s => (
              <tr key={s.key}>
                <td>{stageLabel(s)}</td>
                <td className="gen-model">{s.model ?? '—'}</td>
                <td className="num">{fmt(s.inputTokens)}</td>
                <td className="num">{fmt(s.outputTokens)}</td>
                {anyCost && <td className="num">{fmtCost(s.costUsd)}</td>}
              </tr>
            ))}
          </tbody>
          {totals && (totals.inputTokens != null || totals.outputTokens != null || anyCost) && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="num">{fmt(totals.inputTokens)}</td>
                <td className="num">{fmt(totals.outputTokens)}</td>
                {anyCost && <td className="num">{fmtCost(totals.costUsd)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="gen-stats-foot">
        Generated as a multi-stage pipeline; cheaper models handle the mechanical stages.
      </p>
    </section>
  );
}
