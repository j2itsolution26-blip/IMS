'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, Lock, SlidersHorizontal } from 'lucide-react';
import { settingProblem, type SettingDefinition } from '@/lib/settings-definitions';
import { updateSettings } from '@/features/admin/actions';
import {
  SETTINGS_SECTIONS,
  changedKeys,
  currencySymbol,
  type FieldLayout,
  type SectionLayout,
} from '@/features/admin/settings-sections';
import { SettingsActionBar } from '@/features/admin/settings-action-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Settings editor.
 *
 * Fields come from the catalogue and are arranged by `SETTINGS_SECTIONS`; any
 * setting the layout does not place still appears in a card for its group, so
 * adding a setting makes it editable here with no further UI work. Values are
 * checked with the same `settingProblem` rules the server enforces.
 */

type Errors = Record<string, string>;

const WIDTH: Record<NonNullable<FieldLayout['width']>, string> = {
  short: 'sm:max-w-[12rem]',
  medium: 'sm:max-w-xs',
};

export function SettingsForm({
  definitions,
  values,
  canEdit,
}: {
  definitions: SettingDefinition[];
  values: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  // The last values known to be stored. Follows the server after a refresh,
  // and is updated straight after a save so the form is clean immediately.
  const [saved, setSaved] = React.useState(values);
  React.useEffect(() => setSaved(values), [values]);
  const [draft, setDraft] = React.useState(values);
  const [errors, setErrors] = React.useState<Errors>({});
  const [saving, setSaving] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState('');
  // State updates are async; a ref stops a double click from sending twice.
  const inFlight = React.useRef(false);

  const byKey = React.useMemo(() => new Map(definitions.map((d) => [d.key, d])), [definitions]);
  const changed = React.useMemo(() => changedKeys(draft, saved), [draft, saved]);
  const dirty = changed.length > 0;

  const sections = React.useMemo(() => withFallbacks(SETTINGS_SECTIONS, definitions), [definitions]);

  // The saved currency drives the ₱ shown beside amounts; a half-typed code
  // in the draft must not make every amount field flicker.
  const symbol = currencySymbol(saved['locale.currency'] || 'PHP');

  useUnsavedChangesGuard(dirty && !saving);

  const setValue = (key: string, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // An error clears as soon as the value is fixed, not on the next save.
    if (errors[key]) {
      const definition = byKey.get(key);
      const problem = definition && value !== saved[key] ? settingProblem(definition, value) : null;
      setErrors((current) => {
        const next = { ...current };
        if (problem) next[key] = problem;
        else delete next[key];
        return next;
      });
    }
  };

  const validateOne = (key: string) => {
    const definition = byKey.get(key);
    // An unchanged value is never flagged — the server accepts it as stored.
    if (!definition || draft[key] === saved[key]) return;
    const problem = settingProblem(definition, draft[key] ?? '');
    setErrors((current) => {
      const next = { ...current };
      if (problem) next[key] = problem;
      else delete next[key];
      return next;
    });
  };

  const focusFirst = (keys: string[]) => {
    const first = sections.flatMap((s) => s.fields.map((f) => f.key)).find((key) => keys.includes(key));
    if (first) document.getElementById(first)?.focus();
  };

  const reset = () => {
    setDraft(saved);
    setErrors({});
    setAnnouncement('Changes discarded.');
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit || inFlight.current || !dirty) return;

    const found: Errors = {};
    for (const key of changed) {
      const definition = byKey.get(key);
      const problem = definition ? settingProblem(definition, draft[key] ?? '') : null;
      if (problem) found[key] = problem;
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      const count = Object.keys(found).length;
      setAnnouncement(`${count} field${count === 1 ? ' needs' : 's need'} attention. Nothing was saved.`);
      focusFirst(Object.keys(found));
      return;
    }

    inFlight.current = true;
    setSaving(true);
    const result = await updateSettings(Object.fromEntries(changed.map((key) => [key, draft[key]])));
    inFlight.current = false;
    setSaving(false);

    if (!result.ok) {
      const fieldErrors = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0] ?? 'Invalid value.']),
      );
      setErrors(fieldErrors);
      setAnnouncement(`Settings were not saved. ${result.error}`);
      toast.error(result.error, { duration: 8000 });
      focusFirst(Object.keys(fieldErrors));
      return;
    }

    // Values are stored trimmed; both copies follow so the form is clean.
    const stored = Object.fromEntries(changed.map((key) => [key, (draft[key] ?? '').trim()]));
    setSaved((current) => ({ ...current, ...stored }));
    setDraft((current) => ({ ...current, ...stored }));
    setErrors({});
    const message =
      result.data === 0 ? 'Nothing to save.' : `${result.data} setting${result.data === 1 ? '' : 's'} updated.`;
    setAnnouncement(message);
    toast.success(message);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Store settings" className="space-y-5">
      {!canEdit && (
        <div
          role="note"
          className="flex items-start gap-3 rounded-card border bg-card p-4 text-sm text-muted-foreground shadow-card"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>You have read-only access to settings. Ask an administrator to make changes.</p>
        </div>
      )}

      {sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.fields.map((field) => {
            const definition = byKey.get(field.key);
            if (!definition) return null;
            return (
              <SettingField
                key={field.key}
                field={field}
                definition={definition}
                value={draft[field.key] ?? definition.value}
                changed={changed.includes(field.key)}
                error={errors[field.key]}
                disabled={!canEdit || saving}
                symbol={symbol}
                onChange={(value) => setValue(field.key, value)}
                onBlur={() => validateOne(field.key)}
              />
            );
          })}
        </SettingsSection>
      ))}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {canEdit && <SettingsActionBar changes={changed.length} saving={saving} onCancel={reset} />}
    </form>
  );
}

function SettingsSection({ section, children }: { section: SectionLayout; children: React.ReactNode }) {
  const Icon = section.icon;
  const headingId = `settings-${section.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border bg-card text-card-foreground shadow-card"
    >
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold leading-6">
            {section.title}
          </h2>
          {section.description && <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>}
        </div>
      </header>
      <div className="grid gap-x-6 gap-y-5 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function SettingField({
  field,
  definition,
  value,
  changed,
  error,
  disabled,
  symbol,
  onChange,
  onBlur,
}: {
  field: FieldLayout;
  definition: SettingDefinition;
  value: string;
  changed: boolean;
  error?: string;
  disabled: boolean;
  symbol: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const id = definition.key;
  const label = field.label ?? definition.label;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const rules = definition.rules ?? {};

  if (definition.type === 'BOOLEAN') {
    const on = value === 'true';
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-background/60 p-4 sm:col-span-2">
        <div className="min-w-0">
          <Label htmlFor={id} className="flex items-center gap-2">
            {label}
            {changed && <ChangedDot />}
          </Label>
          <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
            {definition.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {/* Spelled out so the state never depends on the switch colour alone. */}
          <span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
            {on ? 'On' : 'Off'}
          </span>
          <Switch
            id={id}
            checked={on}
            disabled={disabled}
            aria-describedby={descriptionId}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        </div>
      </div>
    );
  }

  const isNumber = definition.type === 'NUMBER';
  const prefix = field.prefix === 'currency' ? symbol : undefined;
  const currencyPreview =
    definition.key === 'locale.currency' && !settingProblem(definition, value) ? formatCurrency(1234.5, value.trim()) : null;

  return (
    <div className={cn('min-w-0 space-y-1.5', field.full && 'sm:col-span-2')}>
      <Label htmlFor={id} className="flex items-center gap-2">
        {label}
        {(rules.required || isNumber) && <span className="sr-only">(required)</span>}
        {changed && <ChangedDot />}
      </Label>

      <div className={cn('relative', field.width && WIDTH[field.width])}>
        {prefix && (
          <span
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground"
            aria-hidden="true"
          >
            {prefix}
          </span>
        )}
        <Input
          id={id}
          name={id}
          type={isNumber ? 'number' : (field.inputType ?? 'text')}
          inputMode={isNumber ? (rules.integer ? 'numeric' : 'decimal') : undefined}
          min={isNumber ? rules.min : undefined}
          max={isNumber ? rules.max : undefined}
          step={isNumber ? (rules.integer ? 1 : 'any') : undefined}
          maxLength={!isNumber ? rules.maxLength : undefined}
          required={rules.required || isNumber}
          autoComplete={field.autoComplete ?? 'off'}
          placeholder={field.placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${descriptionId}` : descriptionId}
          onChange={(event) => onChange(field.uppercase ? event.target.value.toUpperCase() : event.target.value)}
          onBlur={onBlur}
          // Keyboard focus scrolls the field clear of the sticky save bar.
          className={cn('h-10 scroll-mb-28 sm:h-9', prefix && 'pl-8', field.suffix && 'pr-16', isNumber && 'tabular-nums')}
        />
        {field.suffix && (
          <span
            className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted-foreground"
            aria-hidden="true"
          >
            {field.suffix}
          </span>
        )}
      </div>

      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-xs font-medium text-destructive-text">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <p id={descriptionId} className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {definition.description}
          {currencyPreview && (
            <>
              {' '}
              Example: <span className="font-medium text-foreground tabular-nums">{currencyPreview}</span>
            </>
          )}
          {field.suffix && <span className="sr-only"> Measured in {field.suffix}.</span>}
        </span>
        {field.counter && rules.maxLength !== undefined && (
          <span className="shrink-0 tabular-nums" aria-hidden="true">
            {value.length} / {rules.maxLength}
          </span>
        )}
      </p>
    </div>
  );
}

function ChangedDot() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning-text">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
      Edited
    </span>
  );
}

/** Appends a card for every catalogue setting the layout does not place. */
function withFallbacks(layout: SectionLayout[], definitions: SettingDefinition[]): SectionLayout[] {
  const placed = new Set(layout.flatMap((section) => section.fields.map((field) => field.key)));
  const extra = new Map<string, FieldLayout[]>();
  for (const definition of definitions) {
    if (placed.has(definition.key)) continue;
    const fields = extra.get(definition.group) ?? [];
    fields.push({ key: definition.key });
    extra.set(definition.group, fields);
  }
  if (extra.size === 0) return layout;

  return layout
    .map((section) => {
      const more = extra.get(section.group);
      extra.delete(section.group);
      return more ? { ...section, fields: [...section.fields, ...more] } : section;
    })
    .concat(
      [...extra.entries()].map(([group, fields]) => ({
        id: group,
        group,
        title: group.charAt(0).toUpperCase() + group.slice(1),
        description: '',
        icon: SlidersHorizontal,
        fields,
      })),
    );
}

/**
 * Warns before unsaved changes are lost: closing or reloading the tab (the
 * browser's own prompt) and following an in-app link (a confirm, since the
 * App Router has no navigation-blocking API).
 */
function useUnsavedChangesGuard(active: boolean) {
  React.useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value set to show the prompt.
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      if (!window.confirm('You have unsaved changes. Leave this page and discard them?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture phase, so the decision is made before Next's link handler runs.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);
}
