# Form

> The environment-agnostic form document: a `FormSchema` stating what is asked, a `Form` holding
> the answers given against it, declarative `FieldRule` data stating what those answers must
> satisfy, and one submit that settles the form exactly once.

**A terminal prompt and a browser form are the same abstraction.** Both ask a person a set of
questions, hold partial answers, check them against rules, and finish once. What differs is the
host, and each host contributes the one part it owns. Parking is the server environment's
contribution: `answer` is a form whose result nobody has resolved yet, so a server can hand the
document out, wait, and receive the answers back through the same promise a local caller awaits.
Rendering is the browser's contribution, and it lives in the browser, not here. Nothing here
renders, reads a keyboard, or opens a socket. This package ships the document both hosts share.

The core is pure and total. Every guard returns `false` off-shape rather than throwing, every parser
returns `undefined` on refusal, and every value the form hands back is a frozen owned copy.
Form-owned refusals raise `FormError`, and each one names a caller mistake. A custom validator's own
throw escapes the mutation call unchanged.

## Surface

Everything in this guide is exported from `@orkestrel/form` ([`src/core`](../src/core)). Nothing is
internal: every declaration in the module is reachable from the barrel, so a consumer holds exactly
the mechanisms the package uses on itself.

### Open a form, answer it, and settle it

Builds a two-field sign-up form, fills both answers, submits, and awaits the settled result.

```ts
import { createForm } from '@orkestrel/form'

const form = createForm({
	label: 'Sign up',
	fields: [
		{ control: 'text', name: 'email', label: 'Email', rule: { required: true, email: true } },
		{ control: 'confirm', name: 'terms', label: 'I accept the terms', rule: { required: true } },
	],
})

form.fill({ email: 'ada@example.com', terms: true })
const result = form.submit() // { success: true, value: { email: 'ada@example.com', terms: true } }
const answers = await form.answer // { email: 'ada@example.com', terms: true }
```

### Schema and fields

The document itself — what a form asks, in the order it asks it. All data, no behavior. Each
control's own interface adds its members to `FieldBase`, and the control values themselves are
worked through in [Controls](#controls).

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. An extended interface's name comes before `plus`,
with the members it adds after.

| API             | Kind      | Shape                                                                                                                                                                            | Summary                                                                                       |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `FormSchema`    | interface | `{ name?, label?, help?, groups?, fields }`                                                                                                                                      | Describes everything a form asks.                                                             |
| `FormGroup`     | interface | `{ name, label, help? }`                                                                                                                                                         | Represents a named section of a form.                                                         |
| `FormField`     | type      | `TextField \| EditorField \| PasswordField \| NumberField \| DateField \| TimeField \| DatetimeField \| ColorField \| ConfirmField \| SelectField \| CheckboxField \| FileField` | Represents any field a schema can declare.                                                    |
| `FieldBase`     | interface | `{ name, label?, help?, group?, hidden?, disabled?, locked?, rule?, meta? }`                                                                                                     | Declares what every field carries, whatever its control.                                      |
| `FieldControl`  | type      | `'text' \| 'editor' \| 'password' \| 'number' \| 'date' \| 'time' \| 'datetime' \| 'color' \| 'confirm' \| 'select' \| 'checkbox' \| 'file'`                                     | Names the control a field presents to the person answering it.                                |
| `FieldChoice`   | interface | `{ value, label, help?, disabled? }`                                                                                                                                             | Represents one option a `select` or `checkbox` field offers.                                  |
| `TextField`     | interface | `FieldBase plus { control, default?, placeholder? }`                                                                                                                             | Represents a single line of text.                                                             |
| `EditorField`   | interface | `FieldBase plus { control, default?, placeholder? }`                                                                                                                             | Represents text over many lines.                                                              |
| `PasswordField` | interface | `FieldBase plus { control, mask? }`                                                                                                                                              | Represents a secret, obscured as it is typed.                                                 |
| `NumberField`   | interface | `FieldBase plus { control, default?, placeholder? }`                                                                                                                             | Represents a number.                                                                          |
| `DateField`     | interface | `FieldBase plus { control, default? }`                                                                                                                                           | Represents a calendar date, held as the control's own `YYYY-MM-DD` string.                    |
| `TimeField`     | interface | `FieldBase plus { control, default? }`                                                                                                                                           | Represents a time of day, held as the control's own `HH:MM` string, with seconds optional.    |
| `DatetimeField` | interface | `FieldBase plus { control, default? }`                                                                                                                                           | Represents a date and a time of day together, with no zone, held as the control's own string. |
| `ColorField`    | interface | `FieldBase plus { control, default? }`                                                                                                                                           | Represents a color, held as the control's own six-digit `#rrggbb` string.                     |
| `ConfirmField`  | interface | `FieldBase plus { control, default? }`                                                                                                                                           | Represents a single on/off box, holding a boolean.                                            |
| `SelectField`   | interface | `FieldBase plus { control, choices, default?, open? }`                                                                                                                           | Represents one choice out of a list.                                                          |
| `CheckboxField` | interface | `FieldBase plus { control, choices, default? }`                                                                                                                                  | Represents any number of choices out of a list, holding the checked values.                   |
| `FileField`     | interface | `FieldBase plus { control, accept?, multiple? }`                                                                                                                                 | Represents one or more files, by name.                                                        |

### Answers and rules

What a form holds, what its answers must satisfy, and how a failure reports itself.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`.

| API                 | Kind      | Shape                                                                                                | Summary                                                    |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `FieldValue`        | type      | `string \| number \| boolean \| readonly string[]`                                                   | Represents every value a field can hold.                   |
| `FormValues`        | type      | `Readonly<Record<string, FieldValue>>`                                                               | Represents a form's answers, keyed by field name.          |
| `FieldRule`         | interface | `{ required?, minimum?, maximum?, step?, pattern?, email?, url?, integer?, alphanumeric?, custom? }` | Represents the constraints one field's value must satisfy. |
| `FieldRuleName`     | type      | `Exclude<keyof FieldRule, 'custom'>`                                                                 | Lists every rule that reports its failure by name.         |
| `FieldValidator`    | type      | `(value: FieldValue \| undefined, values: FormValues) => true \| string`                             | Checks one value against the whole form.                   |
| `FieldError`        | interface | `{ field, message, rule? }`                                                                          | Represents one failed check against one field.             |
| `EvaluationOptions` | interface | `{ messages?, disabled? }`                                                                           | Describes how to check a schema against a set of answers.  |

### The form

The entity, its factory, its contract, and the error it raises.

A `Shape` cell holds an interface's data members as bare names in braces, `?` marking an
optional member and `plus` introducing its call-signature members, and a type alias's own type
literal with a union's arms escaped as `\|`. A function row's `Shape` cell holds its signature,
and a guard row's the type it narrows to. A class row's `Shape` cell holds the interface it
implements, or its constructor signature where it implements none.

| API             | Kind      | Shape                                                                                                                                                                         | Summary                                                                                                            |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Form`          | class     | `FormInterface`                                                                                                                                                               | Implements `FormInterface` exactly, over an owned schema, the answers given against it, and the errors they carry. |
| `FormInterface` | interface | `{ emitter, schema, values, baseline, errors, touched, disabled, status, valid, dirty, answer } plus field, fill, touch, invalidate, disable, enable, submit, clear, destroy` | Declares the contract a form exposes: the state it holds and the calls that move it.                               |
| `createForm`    | function  | `(schema: FormSchema, options?: FormOptions) => FormInterface`                                                                                                                | Opens a form against a schema.                                                                                     |
| `FormOptions`   | interface | `{ on?, error?, values?, messages? }`                                                                                                                                         | Describes how to open a form.                                                                                      |
| `FormStatus`    | type      | `'editing' \| 'settled' \| 'abandoned'`                                                                                                                                       | Represents where a form sits in its life.                                                                          |
| `FormResult`    | type      | `Result<FormValues, readonly FieldError[]>`                                                                                                                                   | Reports what a submit answers with: the values, or every error that stopped them.                                  |
| `FormEventMap`  | type      | `{ fill, validate, disable, enable, submit, clear, abandon }`                                                                                                                 | Lists everything a form announces.                                                                                 |
| `FormError`     | class     | `new (code: FormErrorCode, message: string, context?: JSONRecord) => FormError`                                                                                               | Represents an error raised by the form domain.                                                                     |
| `FormErrorCode` | type      | `'SCHEMA' \| 'FIELD' \| 'CONTROL' \| 'SETTLED' \| 'ABANDONED'`                                                                                                                | Names the machine-readable code a form error carries.                                                              |
| `isFormError`   | function  | `FormError`                                                                                                                                                                   | Determines whether an unknown value is a form error.                                                               |

`FormInterface`'s readonly data members are the names in its `Shape` cell before `plus`, and they
stay here rather than in `## Methods`; the call-signature members after `plus` are documented under
[Methods](#methods).

### Constants

The control and status registries, the permitted-member table each control is checked against, the
default rule copy, and the shipped patterns — every one of them frozen, so a shared `RegExp` cannot
be recompiled under a consumer. `EMAIL_PATTERN`, `URL_PATTERN`, `ALPHANUMERIC_PATTERN`, and
`INTEGER_PATTERN` are the tests behind the rules they are named for, `INTEGER_PATTERN` on a text
control; `COLOR_PATTERN`, `DATE_PATTERN`, `TIME_PATTERN`, and `DATETIME_PATTERN` are the shapes a
`color`, `date`, `time`, and `datetime` value must have. Each budget's row names its ceiling.
[Budgets](#budgets) then works each ceiling through beside the unit it counts, and
[Patterns and where trust lives](#patterns-and-where-trust-lives) does the same for `PATTERN_LIMIT`.

A `Shape` cell holds the constant's declared type.

| API                    | Kind  | Shape                                               | Summary                                                                                                                         |
| ---------------------- | ----- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `FIELD_CONTROLS`       | const | `readonly FieldControl[]`                           | Lists every field control, in the order declared by the public contract.                                                        |
| `FIELD_BASE_KEYS`      | const | `readonly string[]`                                 | Lists the members every field declares, whatever its control.                                                                   |
| `FIELD_KEYS`           | const | `Readonly<Record<FieldControl, readonly string[]>>` | Lists every member one field control permits, composed from `FIELD_BASE_KEYS` and the members the control's own interface adds. |
| `FORM_STATUSES`        | const | `readonly FormStatus[]`                             | Lists every form lifecycle status.                                                                                              |
| `RULE_MESSAGES`        | const | `Readonly<Record<FieldRuleName, string>>`           | Holds the default failure copy for every named field rule.                                                                      |
| `EMAIL_PATTERN`        | const | `Readonly<RegExp>`                                  | Matches a practical whole-address email shape.                                                                                  |
| `URL_PATTERN`          | const | `Readonly<RegExp>`                                  | Matches an absolute HTTP or HTTPS URL shape.                                                                                    |
| `ALPHANUMERIC_PATTERN` | const | `Readonly<RegExp>`                                  | Matches one or more ASCII letters or digits.                                                                                    |
| `INTEGER_PATTERN`      | const | `Readonly<RegExp>`                                  | Matches a signed or unsigned base-ten integer string.                                                                           |
| `COLOR_PATTERN`        | const | `Readonly<RegExp>`                                  | Matches a six-digit hexadecimal color string.                                                                                   |
| `DATE_PATTERN`         | const | `Readonly<RegExp>`                                  | Matches an ISO calendar date string in `YYYY-MM-DD` form.                                                                       |
| `TIME_PATTERN`         | const | `Readonly<RegExp>`                                  | Matches a 24-hour time string with optional seconds.                                                                            |
| `DATETIME_PATTERN`     | const | `Readonly<RegExp>`                                  | Matches an ISO local date and time string with optional seconds.                                                                |
| `PATTERN_LIMIT`        | const | `number`                                            | Caps the accepted source length for an authored regular expression, at 256.                                                     |
| `FIELD_LIMIT`          | const | `number`                                            | Caps the number of fields one schema may declare, at 512.                                                                       |
| `GROUP_LIMIT`          | const | `number`                                            | Caps the number of groups one schema may declare, at 64.                                                                        |
| `CHOICE_LIMIT`         | const | `number`                                            | Caps the number of choices one `select` or `checkbox` field may offer, at 1024.                                                 |
| `LIST_LIMIT`           | const | `number`                                            | Caps the number of entries one list-valued answer may hold, at 1024.                                                            |
| `NAME_LIMIT`           | const | `number`                                            | Caps the length, in UTF-16 code units, of a schema, group, or field name, at 128.                                               |
| `STRING_LIMIT`         | const | `number`                                            | Caps the length, in UTF-16 code units, of any single retained string, at 65536.                                                 |
| `TEXT_LIMIT`           | const | `number`                                            | Caps the total length, in UTF-16 code units, of every string one schema retains, at 1048576.                                    |
| `NODE_LIMIT`           | const | `number`                                            | Caps the total number of records, arrays, and leaves one schema retains, at 16384.                                              |

### Guards

Total `is*` guards over unknown input. None throws, none coerces, and each returns `false` for
anything off-shape — including a hostile prototype, a symbol key, or a cyclic value. `isFieldValue`
also refuses a number that is not finite, so `NaN` and `Infinity` are not field values, and
`isFormSchema` reads structure alone: domain soundness is `auditSchema`'s question.

In a guard table a `Shape` cell holds the type the guard narrows to.

| API              | Kind     | Shape          | Summary                                                                    |
| ---------------- | -------- | -------------- | -------------------------------------------------------------------------- |
| `isFieldControl` | function | `FieldControl` | Determines whether an unknown value is a declared field control.           |
| `isFormStatus`   | function | `FormStatus`   | Determines whether an unknown value is a form lifecycle status.            |
| `isFieldValue`   | function | `FieldValue`   | Determines whether an unknown value has a form field value shape.          |
| `isFieldChoice`  | function | `FieldChoice`  | Determines whether an unknown value is one exact field choice record.      |
| `isFieldRule`    | function | `FieldRule`    | Determines whether an unknown value is one exact field rule record.        |
| `isFormField`    | function | `FormField`    | Determines whether an unknown value is one exact discriminated form field. |
| `isFormGroup`    | function | `FormGroup`    | Determines whether an unknown value is one exact form group record.        |
| `isFormSchema`   | function | `FormSchema`   | Determines whether an unknown value is one exact structural form schema.   |
| `isFormValues`   | function | `FormValues`   | Determines whether an unknown value is a record of field values.           |
| `isFieldError`   | function | `FieldError`   | Determines whether an unknown value is one exact field error record.       |

### Helpers

The pure leaves the form composes: the prototype-safe record write, `createFieldError`'s rule
failure builder, the control shape test, the evaluation engine, the derivations, and the wire
projection.

| API                | Kind     | Summary                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------- |
| `defineEntry`      | function | Writes one own enumerable data property onto a record.                          |
| `freezeEntry`      | function | Writes one own enumerable data property that cannot be rewritten or removed.    |
| `matchesField`     | function | Checks whether a value has the shape required by one field control.             |
| `matchesAnswer`    | function | Decides whether a raw binding value projects to an answered field.              |
| `appliesRule`      | function | Checks whether a named rule applies to one field control.                       |
| `evaluateField`    | function | Evaluates one field rule against its current value.                             |
| `evaluateForm`     | function | Evaluates every active field in schema order.                                   |
| `computeDefaults`  | function | Computes the values explicitly seeded by a schema.                              |
| `matchesValue`     | function | Compares two field values by scalar identity or ordered list content.           |
| `extractChanges`   | function | Extracts the names whose answers differ between two form value records.         |
| `matchesValues`    | function | Compares two form value records by keys and value content.                      |
| `formatMessage`    | function | Resolves and interpolates one rule message.                                     |
| `createFieldError` | function | Creates one named-rule failure against a field.                                 |
| `serializeForm`    | function | Projects a schema into JSON while removing custom validators and absent values. |
| `extractGroups`    | function | Selects referenced groups in first-reference field order.                       |
| `auditSchema`      | function | Audits a structurally valid schema for domain invariants.                       |

### Cloners

Owned frozen snapshots. The form takes one of the schema at construction, so a later edit to the
schema the caller passed changes nothing inside the form, and no list the form hands back is a live
internal reference.

| API               | Kind     | Summary                                                 |
| ----------------- | -------- | ------------------------------------------------------- |
| `cloneValue`      | function | Clones one form value into an owned frozen snapshot.    |
| `cloneChoices`    | function | Clones a field's choices into an owned frozen snapshot. |
| `cloneFormField`  | function | Clones one form field into an owned frozen snapshot.    |
| `cloneFormSchema` | function | Clones a form schema into an owned frozen snapshot.     |

### Parsers

The wire boundary. Each returns `undefined` on refusal rather than throwing, and each returns an
owned value rather than the caller's.

| API           | Kind     | Summary                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `parseForm`   | function | Parses unknown wire data into an owned, semantically sound form schema. |
| `parseValue`  | function | Parses one answer against its field control.                            |
| `parseValues` | function | Parses a strict answer record against the fields declared by a schema.  |

## Controls

Each control fixes both the options its field accepts and the `FieldValue` it holds. The `confirm`,
`checkbox`, and `datetime` mappings need saying out loud, because a host's vocabulary is wider than
this one and the collapses are deliberate:

- A lone browser checkbox is a `confirm`. It means yes or no and it holds a boolean.
- `checkbox` is the multi-choice group — the terminal's checkbox — and it holds the checked values
  as a list. It is never one box.
- `datetime` is the browser's `datetime-local`: a wall-clock date and time carrying no zone.

Email and url are this package's `text` plus a rule, because they differ from text only in what they
accept: email is `text` with `{ email: true }`, and url is `text` with `{ url: true }`. Tel and
search are `text` with no rule of their own. A telephone number has no one shape this package could
assert across dialling plans, and search names an affordance rather than a constraint, so a schema
that wants a shape for either declares its own `pattern`.

A browser range is a `number` with `minimum`, `maximum`, and `step`. A radio group is a `select` and
a switch is a `confirm` — both are the same question wearing a different affordance, and which
affordance to draw is the renderer's decision. A datalist is a `select` with `open`, which is
exactly what "suggest these, accept anything" means.

| Control    | Value               | Notes                                                          |
| ---------- | ------------------- | -------------------------------------------------------------- |
| `text`     | `string`            | Carries email and url as rules, and tel and search as neither. |
| `editor`   | `string`            | Text over many lines.                                          |
| `password` | `string`            | No `default`: a seeded secret is a secret written down.        |
| `number`   | `number`            | Also carries a range, as `minimum` plus `maximum` plus `step`. |
| `date`     | `string`            | `YYYY-MM-DD`.                                                  |
| `time`     | `string`            | `HH:MM`, seconds optional.                                     |
| `datetime` | `string`            | The browser's datetime-local, no zone.                         |
| `color`    | `string`            | `#rrggbb`, six digits.                                         |
| `confirm`  | `boolean`           | A lone browser checkbox, and a switch.                         |
| `select`   | `string`            | A radio group, and a datalist when `open` is true.             |
| `checkbox` | `readonly string[]` | The multi-choice group.                                        |
| `file`     | `readonly string[]` | Names only. Bytes never enter the document.                    |

### text

Declares a `TextField` carrying a placeholder and a required-and-email rule.

```ts
import type { TextField } from '@orkestrel/form'

const email: TextField = {
	control: 'text',
	name: 'email',
	label: 'Email',
	placeholder: 'you@example.com',
	rule: { required: true, email: true },
}
```

### editor

Declares an `EditorField` bounded by a maximum-length rule.

```ts
import type { EditorField } from '@orkestrel/form'

const bio: EditorField = {
	control: 'editor',
	name: 'bio',
	label: 'About you',
	rule: { maximum: 500 },
}
```

### password

`password` carries no `default`, so `computeDefaults` never seeds one. `mask` is the character the
control repeats in place of the text, and the form stores the real value untouched.

```ts
import type { PasswordField } from '@orkestrel/form'

const secret: PasswordField = {
	control: 'password',
	name: 'secret',
	label: 'Password',
	mask: '*',
	rule: { required: true, minimum: 12 },
}
```

### number

A browser range is this field with `minimum`, `maximum`, and `step` all set.

```ts
import type { NumberField } from '@orkestrel/form'

const volume: NumberField = {
	control: 'number',
	name: 'volume',
	label: 'Volume',
	default: 5,
	rule: { minimum: 0, maximum: 11, step: 1 },
}
```

### date

Declares a `DateField` bounded by a minimum and a maximum calendar date.

```ts
import type { DateField } from '@orkestrel/form'

const start: DateField = {
	control: 'date',
	name: 'start',
	label: 'Start date',
	rule: { minimum: '2026-01-01', maximum: '2026-12-31' },
}
```

### time

Declares a `TimeField` with a default and a minimum-and-maximum time-of-day rule.

```ts
import type { TimeField } from '@orkestrel/form'

const opens: TimeField = {
	control: 'time',
	name: 'opens',
	label: 'Opening time',
	default: '09:00',
	rule: { minimum: '06:00', maximum: '22:00' },
}
```

### datetime

Declares a `DatetimeField` bounded by a minimum date and time.

```ts
import type { DatetimeField } from '@orkestrel/form'

const slot: DatetimeField = {
	control: 'datetime',
	name: 'slot',
	label: 'Appointment',
	rule: { minimum: '2026-01-01T09:00' },
}
```

### color

Declares a `ColorField` seeded with a default six-digit color.

```ts
import type { ColorField } from '@orkestrel/form'

const brand: ColorField = {
	control: 'color',
	name: 'brand',
	label: 'Brand color',
	default: '#3366ff',
}
```

### confirm

Declares a `ConfirmField` a submit refuses to pass until it is required and checked.

```ts
import type { ConfirmField } from '@orkestrel/form'

const terms: ConfirmField = {
	control: 'confirm',
	name: 'terms',
	label: 'I accept the terms',
	rule: { required: true },
}
```

### select

`open` admits a value the list does not offer, which is what turns a closed menu into a suggestion
list. A choice marked `disabled` is shown and refused at every door, including seeded values.
Filter stored answers through `parseValues` or `parseValue` before seeding them; an `undefined`
result means the value is no longer legal. A closed, all-disabled select is unanswerable and faults
when required, whether or not the field itself is declared disabled; an open select and an optional
select are both legal.

```ts
import type { SelectField } from '@orkestrel/form'

const plan: SelectField = {
	control: 'select',
	name: 'plan',
	label: 'Plan',
	choices: [
		{ value: 'free', label: 'Free' },
		{ value: 'pro', label: 'Pro', help: 'Everything in Free, plus support' },
		{ value: 'legacy', label: 'Legacy', disabled: true },
	],
	default: 'free',
}
```

### checkbox

A checkbox value is the checked values as a list. Duplicates are refused, and `minimum` and
`maximum` count selections rather than characters. `required` is satisfied by any present answer,
including the empty list; an empty submission is a valid "none selected".

```ts
import type { CheckboxField } from '@orkestrel/form'

const topics: CheckboxField = {
	control: 'checkbox',
	name: 'topics',
	label: 'Interests',
	choices: [
		{ value: 'releases', label: 'Releases' },
		{ value: 'security', label: 'Security' },
	],
	default: ['releases'],
	rule: { minimum: 1 },
}
```

### file

A file value is a list of names. `multiple` admits more than one, and without it a second name is
refused.

```ts
import type { FileField } from '@orkestrel/form'

const documents: FileField = {
	control: 'file',
	name: 'documents',
	label: 'Supporting documents',
	accept: ['application/pdf', '.png'],
	multiple: true,
	rule: { maximum: 3 },
}
```

### meta

`meta` is not a control. It is the bounded JSON carrier every field has, on `FieldBase`, for
whatever the schema declines to model — an icon, a column width, an analytics key, a renderer hint.
The properties that follow define it, and together they are why it can be there at all.

**Evaluation never reads it.** No rule sees it, no error can come from it, and `evaluateForm` gives
the same answers whether it is present or absent. It is inert by construction, not by convention.

**It round-trips verbatim.** `serializeForm` writes it out and `parseForm` reads it back, key for
key and value for value, because it is already JSON. Nothing in this package rewrites, prunes, or
namespaces what a host put there.

**It is bounded JSON.** `isFormField` admits it only through `isBoundedJSONRecord`, so a cyclic
value, a value nested past that guard's depth bound, and anything that is not JSON — a function, a
symbol — each refuse the whole field. Depth is the guard's job; size is the audit's, and the
following budgets count `meta`'s strings and nodes. They count it a little more strictly than the
schema's own: a key inside `meta` counts against the text budget, and the schema's own keys —
`control`, `name`, `rule` — do not. The stricter side is the one the host controls, which is the
right way round.

The guard reads structure alone, so it admits one record that ownership then refuses: a `meta` whose
keys are accessors rather than data. That record is bounded JSON by shape, and `cloneFormField`
copies enumerable data properties only, so taking ownership of it throws `FormError` coded `SCHEMA`
naming the field. The constructor reaches that refusal through the same clone, which is why a field
`isFormField` accepted can still be refused when a form opens against it. `serializeForm` refuses
the same record the same way — `SCHEMA` naming the field — and `parseForm` answers it as every
refusal: `undefined`.

**This package defines no key in it.** Every key belongs to the host, so two hosts can carry
different vocabularies through the same document and neither collides with the package. A key this
package started reading would stop being the host's.

It is declared on fields only. The first consumer asked for a field carrier, and an exact guard
refuses `meta` on `FormSchema`, `FormGroup`, and `FieldChoice` rather than admitting a member
nothing reads. The form owns what it stores, so `form.field(name)` hands back a frozen
null-prototype copy rather than the caller's object.

```ts
import {
	createForm,
	evaluateForm,
	isFieldChoice,
	isFormGroup,
	parseForm,
	serializeForm,
} from '@orkestrel/form'
import type { FormSchema } from '@orkestrel/form'

const schema: FormSchema = {
	fields: [{ control: 'text', name: 'email', meta: { icon: 'mail', order: 2 } }],
}

evaluateForm(schema, {}) // [] — meta is never evaluated

const wire = JSON.stringify(serializeForm(schema))
wire // '{"fields":[{"control":"text","name":"email","meta":{"icon":"mail","order":2}}]}'
JSON.stringify(parseForm(JSON.parse(wire))) === wire // true — verbatim, both directions

isFormGroup({ name: 'account', label: 'Account', meta: {} }) // false — groups carry no meta
isFieldChoice({ value: 'a', label: 'A', meta: {} }) // false — nor do choices

const form = createForm(schema)
form.field('email')?.meta // { icon: 'mail', order: 2 } — an owned frozen copy
Object.getPrototypeOf(form.field('email')?.meta ?? {}) // null
```

### Rendering

A renderer picks an affordance from what a field asks a person for, not from the name its control
carries. The categories that decision is made in are the portable ones the `enterprise-bootstrap`
skill catalogs in its `references/inputs.md` file, which every scaffold target carries at
`.agents/skills/enterprise-bootstrap/references/inputs.md`. The category names in the
table are that catalog's own, and a category name is the join key: read the row here, then open the
section carrying that name there.

Every field owes the same things whatever its category: its `label`, its `help`, a message for each
`FieldError` it carries keyed by that error's `rule`, and the display policy over `touched` that
holds a message back until somebody has visited the field. `hidden`, `locked`, and `disabled`
change what is drawn in every category alike; see [The visibility switches](#the-visibility-switches)
for the obligation each one carries. The table states what a control owes on top of those.

| Control    | Category             | What moves it                                                                                                                      | What the renderer owes                                                                                                            |
| ---------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `text`     | One line of text     | Nothing. `email`, `url`, and `pattern` narrow what the line accepts and leave the category where it is.                            | One line whatever the rule says: email, url, tel, and search are all this control.                                                |
| `editor`   | Text over many lines | Nothing.                                                                                                                           | The height of the box. The document states no row count.                                                                          |
| `password` | A secret             | Nothing.                                                                                                                           | Obscure the text as it is typed, repeating `mask` where the schema names one, and seed nothing: the control carries no `default`. |
| `number`   | A number             | `minimum`, `maximum`, and `step` all set — that is a number in a bounded range.                                                    | The bounded affordance only when `minimum`, `maximum`, and `step` are all set, and a plain number otherwise.                      |
| `date`     | A date               | Nothing.                                                                                                                           | The value is the control's own `YYYY-MM-DD` string. Reading a person's localized entry back into it is the binding's parse.       |
| `time`     | A time               | Nothing.                                                                                                                           | The value is the control's own `HH:MM` string, seconds optional.                                                                  |
| `datetime` | A date and time      | Nothing.                                                                                                                           | The value carries no zone, so a renderer that shows one has invented it.                                                          |
| `color`    | A color              | Nothing.                                                                                                                           | The value is `#rrggbb`, six digits, whatever picker produced it.                                                                  |
| `confirm`  | One on/off answer    | Nothing.                                                                                                                           | One box or a switch, and which of them to draw is the renderer's decision.                                                        |
| `select`   | One of a few         | `open` — that is one of many with an unlisted value admitted. A list longer than the renderer draws at once — that is one of many. | Show a choice marked `disabled` and refuse it, seeded values included.                                                            |
| `checkbox` | Any of a few         | A list longer than the renderer draws at once — that is any of many.                                                               | Refuse a duplicate, and count selections rather than characters where `minimum` or `maximum` is set.                              |
| `file`     | Files                | Nothing. `multiple` changes how many names the value holds, not the category.                                                      | Names only, filtered by `accept` and bounded by `multiple`. Bytes never enter the document.                                       |

The catalog's remaining categories have no control of their own here. A renderer draws each over a
control the document already carries, or leaves it outside the document, so a renderer never
invents a control:

- **A value picked from a searched list** — `select`, and `select` with `open` where the search must
  admit a value the list does not offer. `choices` is data in the schema, so the search field, the
  ranking, and the menu belong to the renderer, and a list fetched while somebody types is the host
  building a new schema.
- **An ordered set of tags** — `checkbox` over a fixed vocabulary, whose value keeps the order it
  was filled in. Tags a person types freely are outside the document: `checkbox` admits a listed
  value only, and no control holds a list of unlisted ones.
- **A rating** — `select` over the fixed values, which is the radio group the catalog draws, or
  `number` with `minimum`, `maximum`, and `step` where the scale is continuous.
- **A step in a sequence** — outside the document. A step indicator reports position rather than
  holding an answer, and sequencing several forms is the host's work.

## Rules

A rule is data, not a closure. That is what lets a schema cross a wire and validate on the other
side exactly as it validated here — with the single exception of `custom`, which is a function and
therefore does not travel.

| Rule           | Operand          | What it measures                                                                                                                                  |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`     | `true`           | That an answer exists at all. Presence only: `''`, `[]`, `false`, and `0` are answers and satisfy it.                                             |
| `minimum`      | number or string | Characters for text, editor, and password; magnitude for number; chronology for `date`, `time`, and `datetime`; selections for checkbox and file. |
| `maximum`      | number or string | The same measure as `minimum`, at the other end.                                                                                                  |
| `step`         | number           | The interval a numeric value must land on, counted from `minimum` or from zero. Number only.                                                      |
| `pattern`      | string           | Regular-expression source the whole value must match. String-valued controls only.                                                                |
| `email`        | `true`           | That the whole value is an email address, per `EMAIL_PATTERN`.                                                                                    |
| `url`          | `true`           | That the whole value is an absolute HTTP or HTTPS URL, per `URL_PATTERN`.                                                                         |
| `integer`      | `true`           | That a number has no fractional part, or that a string is a base-ten integer.                                                                     |
| `alphanumeric` | `true`           | That the whole value is ASCII letters and digits, per `ALPHANUMERIC_PATTERN`.                                                                     |
| `custom`       | `FieldValidator` | Anything the rest cannot say. It runs last, on an absent value too, and it is the only rule that sees the rest of the form.                       |

The operand's type follows the control family. `minimum` and `maximum` take a number wherever the
measure is a count or a magnitude, and take a string written in the control's own format wherever
the measure is chronology — `'2026-01-01'` for a date, `'09:00'` for a time. `auditSchema` refuses
the mismatch rather than letting it fail silently at evaluation time.

Bounds compare temporal strings lexically. Spell each operand and value at the same precision:
because seconds are optional, `'09:00'` sorts before `'09:00:00'`.

`step` is number-only. A temporal step is not in this package; see the concept inventory.

```ts
import { evaluateField, formatMessage } from '@orkestrel/form'
import type { NumberField } from '@orkestrel/form'

const volume: NumberField = {
	control: 'number',
	name: 'volume',
	rule: { minimum: 0, maximum: 11, step: 1 },
}

evaluateField(volume, 12, {})
// [{ field: 'volume', message: 'Must be at most 11', rule: 'maximum' }]
evaluateField(volume, 0.5, {})
// [{ field: 'volume', message: 'Must be a multiple of 1', rule: 'step' }]

formatMessage('minimum', 8) // 'Must be at least 8'
formatMessage('required', undefined, { required: 'We need this one' }) // 'We need this one'
```

### How an answer is counted

**`undefined` is the only absence.** A field is unanswered when `values` has no key for it, and
answered otherwise. `''`, a string of spaces, `[]`, `false`, and `0` are all answers, so `required`
is satisfied by every one of them. `required` asks whether an answer exists, never whether it says
anything: a length rule is `minimum`, and a "must be ticked" rule is `custom`.

**This is not HTML's model, and the difference is deliberate.** A browser fails `required` on the
exact empty string, so an empty text input is unanswered there and answered here. Neither model is
wrong — HTML has one input surface and this document has many — but a binding that wants HTML's
answer has to say so, and `matchesAnswer` is where it says it.

**Project at the binding, not in the rules.** `matchesAnswer` is the documented projection: it is
false for absence and for a string that is only whitespace, and true for every other value including
`[]`, `false`, and `0`. Fill through it, and the empty box arrives as absence:

```ts
import { createForm, matchesAnswer } from '@orkestrel/form'

matchesAnswer(undefined) // false
matchesAnswer('') // false
matchesAnswer('   ') // false — whitespace alone is not an answer
matchesAnswer('ada') // true
matchesAnswer([]) // true — an empty list is an answered "none of them"
matchesAnswer(false) // true
matchesAnswer(0) // true

const form = createForm({
	fields: [{ control: 'text', name: 'email', rule: { required: true } }],
})

// The binding's own line, once, wherever a raw control value arrives.
const raw = '   '
form.fill('email', matchesAnswer(raw) ? raw : undefined)

form.values.email // undefined — the projection cleared it
form.errors.length // 1 — and `required` then reports it
```

Core evaluation does not use this projection. Keeping it at the binding is what lets one schema
serve a browser input that treats blank as empty and a terminal prompt that treats a bare return as
skipped, without the schema knowing which host it is on.

### The custom seam

`custom` receives two arguments: the value the field holds — or `undefined` when nobody has answered
it — and every answer the form holds. The second is what makes a cross-field rule possible without a
second mechanism, because a confirmation field
reads its sibling directly. It returns `true` to pass, or the message explaining the failure, and
that message travels as a `FieldError` with no `rule`, because the failure belongs to no named rule.
A validator's own throw escapes the mutation call unchanged; only form-owned refusals are
`FormError`.

```ts
import { evaluateField } from '@orkestrel/form'
import type { FieldValidator, PasswordField } from '@orkestrel/form'

const matches: FieldValidator = (value, values) =>
	value === values.password ? true : 'Both passwords must match'

const again: PasswordField = { control: 'password', name: 'again', rule: { custom: matches } }

evaluateField(again, 'hunter3', { password: 'hunter2' })
// [{ field: 'again', message: 'Both passwords must match' }]
```

**`custom` runs on an absent value too**, after every named rule, which is what makes "required once
the sibling says yes" expressible without a second mechanism. An unanswered field can therefore
carry a `required` message and this validator's own together, and each one is a separate
`FieldError`.

```ts
import { evaluateField } from '@orkestrel/form'
import type { FieldValidator, TextField } from '@orkestrel/form'

const whenBusiness: FieldValidator = (value, values) =>
	values.account === 'business' && value === undefined ? 'A VAT number is required' : true

const vat: TextField = { control: 'text', name: 'vat', rule: { custom: whenBusiness } }

evaluateField(vat, undefined, { account: 'business' })
// [{ field: 'vat', message: 'A VAT number is required' }]
evaluateField(vat, undefined, { account: 'personal' }) // []
```

The same seam closes a list of addresses. `TextField` has no `multiple`, because that word already
means a list of file names on `FileField` and one word cannot hold two value shapes. A field that
takes several addresses is `text` plus a `custom` that splits the value and tests each part with the
exported `EMAIL_PATTERN` — the same pattern the `email` rule uses, so the two agree by construction.

```ts
import { evaluateField, EMAIL_PATTERN } from '@orkestrel/form'
import type { FieldValidator, TextField } from '@orkestrel/form'

const addresses: FieldValidator = (value) =>
	typeof value !== 'string' ||
	value
		.split(',')
		.map((entry) => entry.trim())
		.every((entry) => EMAIL_PATTERN.test(entry))
		? true
		: 'Every address must be valid'

const to: TextField = { control: 'text', name: 'to', rule: { custom: addresses } }

evaluateField(to, 'ada@example.com, grace@example.com', {}) // []
evaluateField(to, 'ada@example.com, nope', {})
// [{ field: 'to', message: 'Every address must be valid' }]
```

### Messages

`FormOptions.messages` replaces a rule's default copy, keyed by `FieldRuleName`. `{limit}` in the
replacement is substituted with the rule's operand exactly as it is in `RULE_MESSAGES`. `custom` is
absent from `FieldRuleName` because a custom rule supplies its own message and nothing keyed by a
rule name would ever be read for it.

### Patterns and where trust lives

`pattern` is authored regular-expression source, so it is the one rule that can carry an attack.
`PATTERN_LIMIT` bounds the source this package will compile, and the wire boundary keeps a schema
data only. Each is deliberate.

`PATTERN_LIMIT` is 256 characters. A longer source is never compiled: `auditSchema` reports it, so
`createForm` and `parseForm` both refuse the schema, and `evaluateField` fails the field on the
`pattern` rule rather than handing the source to `RegExp`.

A pattern within `PATTERN_LIMIT` can still backtrack catastrophically. This package applies no time
bound. Evaluating an untrusted pattern spends the caller's thread. The wire boundary remains data
only: `serializeForm` drops every `custom` validator on the way out, and `parseForm` drops every
`custom` member on the way in. Parse a peer's schema through `parseForm`, which refuses an over-long
or uncompilable pattern, and decide whether its remaining patterns are trusted before evaluation.

```ts
import { auditSchema, evaluateField, PATTERN_LIMIT } from '@orkestrel/form'
import type { TextField } from '@orkestrel/form'

const long: TextField = {
	control: 'text',
	name: 'code',
	rule: { pattern: 'a'.repeat(PATTERN_LIMIT + 1) },
}

auditSchema({ fields: [long] })
// ['Field "code" has a pattern longer than 256']
evaluateField(long, 'aaa', {})
// [{ field: 'code', message: 'Must match the required format', rule: 'pattern' }]
```

### Budgets

`PATTERN_LIMIT` is one of the budgets. The others bound how much a schema and its answers can be, so
a document that arrives from a wire cannot cost unbounded memory or unbounded scanning before
anything decides to trust it. Every one is exported, so a host can check against the same number the
package checks against.

| Constant       | Value   | Unit                    | Bounds                                    |
| -------------- | ------- | ----------------------- | ----------------------------------------- |
| `FIELD_LIMIT`  | 512     | fields                  | One schema's `fields`                     |
| `GROUP_LIMIT`  | 64      | groups                  | One schema's `groups`                     |
| `CHOICE_LIMIT` | 1024    | choices                 | One `select` or `checkbox` field's list   |
| `NAME_LIMIT`   | 128     | UTF-16 code units       | Each schema, group, and field name        |
| `STRING_LIMIT` | 65536   | UTF-16 code units       | Any one retained string                   |
| `TEXT_LIMIT`   | 1048576 | UTF-16 code units       | Every string one schema retains, together |
| `NODE_LIMIT`   | 16384   | records, arrays, leaves | Everything one schema retains, together   |
| `LIST_LIMIT`   | 1024    | entries                 | One list-valued answer                    |

They bind at the schema door and the value door, and which door a limit sits at is the whole story.

**The schema door reports.** `auditSchema` counts fields, groups, choices, names, strings, total
text, and total nodes — `meta` included, since it is retained like everything else — and returns one
human diagnostic per breach, beside `PATTERN_LIMIT`'s. `createForm` throws `SCHEMA` carrying them
and `parseForm` refuses the schema, so no over-budget schema is ever held.

**The value door refuses.** `matchesField` checks `STRING_LIMIT` on any string and `LIST_LIMIT` on
any list before it consults the control, so the check happens **before any regular expression sees
the value**. `fill` and a seeded value throw `CONTROL`; `parseValue` and `parseValues` return
`undefined`.

`STRING_LIMIT` is the one that stands at both: the same ceiling holds a schema's own strings and an
answer's, so no string this package retains is longer than 65536 code units whichever way it
arrived.

The whole-schema ceilings are what make the arithmetic safe. Whatever the per-item limits admit, one
audited schema retains at most 1048576 string code units and at most 16384 nodes — roughly two
megabytes of text — so the worst case is `TEXT_LIMIT` and `NODE_LIMIT`, never the product of the
others.

Regular-expression time, a `custom` validator's own work, and the structural read at the parse door
stay unbounded, each for its own reason. Regular-expression **time** is not bounded here, exactly as
the "Guards are total and parsers refuse" invariant under [Contract](#contract) states: a source
within `PATTERN_LIMIT` can still backtrack catastrophically, and evaluating an untrusted pattern
spends the caller's thread. And `custom` is in-process code the schema's own author wrote, so it is
trusted like any other function the host calls; it does not cross the wire, and nothing here limits
what it does.

The structural **read** at the parse door is unbounded for a different reason, and refusing an
over-budget schema is where it shows. The budgets bound what a schema may **retain**, and they bound
how far the audit **walks** to name a fault: the field pass stops at `FIELD_LIMIT` and the node pass
stops at `NODE_LIMIT`, so a fault beyond either ceiling goes unnamed while the breached ceiling
itself is reported. They do not bound the read that happens before any of that. `parseForm` copies
and guards every field that arrived before the audit sees one of them, so a payload four times over
`FIELD_LIMIT` is read four times over and then refused. Bound the size of a payload at the transport
that delivers it, which is the only layer holding the bytes.

```ts
import { auditSchema, matchesField, LIST_LIMIT, STRING_LIMIT } from '@orkestrel/form'
import type { CheckboxField } from '@orkestrel/form'

auditSchema({ fields: [{ control: 'text', name: 'n'.repeat(129) }] })
// ['Schema contains a name longer than 128']
auditSchema({ fields: [{ control: 'text', name: 'a', label: 'x'.repeat(STRING_LIMIT + 1) }] })
// ['Schema contains a string longer than 65536']

const topics: CheckboxField = {
	control: 'checkbox',
	name: 't',
	choices: [{ value: 'a', label: 'A' }],
}

matchesField(
	topics,
	Array.from({ length: LIST_LIMIT + 1 }, () => 'a'),
) // false — refused by count
matchesField({ control: 'text', name: 'a' }, 'x'.repeat(STRING_LIMIT + 1)) // false — before any regex
```

### Auditing a schema

`auditSchema` is the semantic pass that structural validation cannot do: duplicate names, a missing
group, a default its own control cannot hold, a rule on a control that cannot measure it, a minimum
above its maximum, an uncompilable pattern, or a breach of any named budget. It also reports the
bounds no answer could satisfy: a required closed `select` with no enabled choice, a `checkbox` whose
positive `minimum` exceeds its enabled-choice count, and a negative `maximum` on a control that
measures a length or a count — `text`, `editor`, `password`, `checkbox`, or `file`. A required
`checkbox` alone remains satisfiable because `[]` is a present answer, `maximum: 0` on a `text` is
satisfiable by `''`, and a negative `maximum` on a `number` is an ordinary value bound.

**Every one of those faults holds for every field, disabled or not.** `auditSchema` takes the schema
and nothing else: no satisfiability arm reads `FieldBase.disabled`, and no runtime `disable` or
`enable` can change a diagnostic. That is why a declared-disabled field earns no exemption — it can
be put back into play at any moment, so a field that would be unanswerable the instant it is enabled
is a fault the audit names while a schema editor can still fix it.

**What a passing audit proves is that list and nothing wider.** Each check is a fixed question about
the schema's own declarations, so a passing schema is free of those faults under every runtime
disabled set — none of them depends on one. It is not a proof that some answer set exists. `custom`
is a function, the audit never calls it, and a validator that refuses every value passes the audit
and fails at evaluation.

The audit runs inside `createForm` and inside `parseForm`, so a consumer rarely calls it directly —
but it is exported, because a schema editor wants the diagnostics before it constructs anything.

**Its returned strings are human diagnostics, not a stable machine contract.** Read them, show them,
log them. Do not branch on their text or parse a field name out of them: the wording is free to
change with the diagnostics, and only the emptiness of the list is a promise. Where a machine
outcome is what you need, use the guards, or use `parseForm` and read `undefined`.

```ts
import { auditSchema } from '@orkestrel/form'

auditSchema({
	fields: [
		{ control: 'text', name: 'a' },
		{ control: 'text', name: 'a' },
	],
})
// ['Field "a" is declared more than once']
auditSchema({ fields: [{ control: 'number', name: 'n', rule: { minimum: '3' } }] })
// ['Field "n" has a string minimum on number']
auditSchema({
	fields: [
		{
			control: 'select',
			name: 'plan',
			disabled: true,
			choices: [{ value: 'legacy', label: 'Legacy', disabled: true }],
			rule: { required: true },
		},
	],
})
// ['Field "plan" is required but offers no enabled choice'] — a declared-disabled field is no exemption
auditSchema({ fields: [{ control: 'text', name: 'code', rule: { maximum: -1 } }] })
// ['Field "code" has a negative maximum on text'] — no answer has a negative length
auditSchema({ fields: [{ control: 'text', name: 'email' }] }) // []
```

### The temporal patterns are lexical

`DATE_PATTERN`, `TIME_PATTERN`, and `DATETIME_PATTERN` check spelling, not calendars. They accept a
four-digit year, a month in 01–12, and a day in 01–31 — with no knowledge of month length and no
knowledge of leap years. `'2026-02-31'` is therefore a lexically valid `date` value, and this
package accepts it.

That is the boundary this package draws, and it draws it on purpose: a calendar is a host concern,
and the host that renders a date control already refuses an impossible day. Where a real calendar
date matters to your domain, add the check as a `custom` rule, which is exactly the seam it belongs
in.

```ts
import { matchesField } from '@orkestrel/form'
import type { DateField } from '@orkestrel/form'

const when: DateField = { control: 'date', name: 'when' }

matchesField(when, '2026-02-31') // true — lexically valid, no calendar is consulted
matchesField(when, '2026-13-01') // false — month 13 is not spelled correctly
```

## Lifecycle and state

A form opens `editing`, turns `settled` on its first valid submit, and turns `abandoned` when it is
destroyed before settling. Both end states are terminal, and every write to a form in either one is
refused with a `FormError`. Every getter keeps answering afterwards.

A destroy requested while a mutation batch is open records the request, refuses every subsequent
write from that instant, and defers teardown until the outermost batch closes. The batch's own
outcome wins. If it settles the form, the form ends `settled`, `answer` resolves, and no `abandon`
is emitted. Teardown never advances into the batch, and the batch is never aborted or rolled back.
The pending request is private, unnamed state, so `FormStatus` gains no fourth member.

**There is no `check()`.** `errors` is computed at construction and after every mutation whose
evaluation completes, and the `validate` event fires exactly when that list's content changes. If a
custom validator throws mid-mutation, the throw escapes after earlier state changes and leaves the
previous error list in place. The "Errors are current after completed evaluation" invariant under
[Contract](#contract) states the exact partial-state boundary.

**`valid` and `dirty` are derived on read.** `valid` is true when `errors` is empty. `dirty` is true
once the answers differ from `baseline`, the ones the form opened with. Neither is stored, so
neither can drift.

**`touched` is the fields somebody has visited.** It is what lets a renderer withhold an error until
the person has had their turn at the field. A failed submit marks every enabled field touched, so
the errors the person has not reached yet become showable at exactly the moment they matter.

```ts
import { createForm } from '@orkestrel/form'

const form = createForm({
	fields: [
		{ control: 'text', name: 'email', rule: { required: true, email: true } },
		{ control: 'confirm', name: 'terms', rule: { required: true } },
	],
})

form.errors.length // 2 — current from the moment the form opens
form.valid // false
form.dirty // false
form.status // 'editing'

form.field('email')?.control // 'text'
form.touch('email')
form.touched.has('email') // true

form.fill('email', 'ada@example.com')
form.dirty // true
form.errors.length // 1

form.submit().success // false — `terms` is still unanswered
Array.from(form.touched) // ['email', 'terms'] — a failed submit touches every enabled field

form.fill('terms', true)
form.submit() // { success: true, value: { email: 'ada@example.com', terms: true } }
form.status // 'settled'
```

### The visibility switches

They differ in what they remove, and the difference is load-bearing.

| Switch     | Renderer obligation          | `fill`  | Validated | Submitted |
| ---------- | ---------------------------- | ------- | --------- | --------- |
| `hidden`   | omit                         | accepts | yes       | yes       |
| `locked`   | render without person edits  | accepts | yes       | yes       |
| `disabled` | omit or render without edits | accepts | no        | no        |

`hidden` keeps a field out of the rendered form while it still travels. `locked` renders it
unwritable. `disabled` takes the field out of the form entirely: it is neither evaluated nor
submitted, and its value may still appear in `values` so a renderer can show it.
`fill` refuses none of `hidden`, `locked`, and `disabled`; they constrain rendering, evaluation,
and submission, not programmatic writes.

`FieldBase.disabled` is the field's **declared, opening** state. `FormInterface.disabled` is the
**current fact**, and the next section is how it moves.

```ts
import { createForm } from '@orkestrel/form'

const form = createForm({
	fields: [
		{ control: 'text', name: 'email', rule: { required: true } },
		{
			control: 'text',
			name: 'legacy',
			disabled: true,
			default: 'kept',
			rule: { required: true, email: true },
		},
	],
})

form.values // { legacy: 'kept' } — present for a renderer
form.errors.length // 1 — only `email`; the disabled field is not evaluated

form.fill('email', 'ada@example.com')
form.submit() // { success: true, value: { email: 'ada@example.com' } } — `legacy` is not submitted
```

### Taking a field out, and putting it back

`disable` and `enable` move a field between being in the form and being out of it, while the form is
live. Each is one verb whose overloads take no argument for every field, one name for one field, or
a list of names for those. There is no group overload, because a host expands a group in one line
from the schema it already holds, and a group argument would be a second way to say the same thing.

```ts
import { createForm } from '@orkestrel/form'

const form = createForm({
	groups: [{ name: 'billing', label: 'Billing' }],
	fields: [
		{ control: 'text', name: 'card', group: 'billing', rule: { required: true } },
		{ control: 'text', name: 'zip', group: 'billing', rule: { required: true } },
		{ control: 'text', name: 'email', rule: { required: true } },
	],
})

// A group, expanded by the host from the schema it already holds.
const billing = form.schema.fields.filter((field) => field.group === 'billing')
form.disable(billing.map((field) => field.name))

Array.from(form.disabled) // ['card', 'zip']
form.errors.length // 1 — only `email` is still in the form
```

**The schema declares, the form decides.** `FieldBase.disabled` is what the schema said when the
form opened. Each `disable` or `enable` records a runtime decision that sits over that declaration,
and `form.disabled` is the declaration and the decision read together — the current fact, and the
set every other part of the form reads: evaluation skips it, a submit leaves it out of the answers,
and a failed submit does not touch it.

**A batch is all-or-nothing.** Every name in a list is checked against the schema before any field
moves, so one unknown name throws `FormError` coded `FIELD` and the call changes nothing.

**Each announces only what moved.** `disable` and `enable` each fire once per field whose effective
state actually changed, in the order the schema declares the fields. A call that moves nothing —
disabling what is already out — returns before it writes anything: no event, no recompute, no
overlay entry. `fill` is not the same. An unchanged answer suppresses the `fill` event, but the
answer is still rewritten, the field's invalidation is still dropped, and the error list is still
recomputed.

**An invalidation survives the trip.** A field's external failure is kept while it is out, withheld
from `errors`, and reappears when it comes back. Disabling a field to skip its rules does not erase
what a server told you about it.

**`clear` resets the overlay.** Clearing returns the form to how it opened, and the runtime decisions
are part of that: `disabled` reads the schema's declarations again, beside the restored answers and
the cleared `touched` set. **The `clear` event is the whole announcement of that reset**: the
restored answers emit no `fill`, and the overlay reset emits no `disable` and no `enable`. A listener
that maintains its own picture from events alone reads one `clear` as everything having gone back,
rather than waiting for per-field news that never comes.

Both are writes, so a settled or abandoned form refuses them with `SETTLED` or `ABANDONED`. And
because any declared-disabled field can be enabled at any moment, `auditSchema` holds every field to
the same satisfiability standard whether it is declared disabled or not: it reads the schema alone,
so no declaration and no runtime decision changes a diagnostic.

```ts
import { createForm } from '@orkestrel/form'

const moved: string[] = []

const form = createForm(
	{
		fields: [
			{ control: 'text', name: 'email', rule: { required: true } },
			{ control: 'text', name: 'nickname', rule: { required: true } },
			{ control: 'text', name: 'legacy', disabled: true, default: 'kept' },
		],
	},
	{
		on: {
			fill: (name) => moved.push(`fill ${name}`),
			disable: (name) => moved.push(`disable ${name}`),
			enable: (name) => moved.push(`enable ${name}`),
		},
	},
)

Array.from(form.disabled) // ['legacy'] — the schema's declaration, before anything moves
form.errors.length // 2 — `email` and `nickname`

form.disable('nickname')
Array.from(form.disabled) // ['nickname', 'legacy'] — in schema order
form.errors.length // 1 — a field that is out is not evaluated
form.disable('nickname') // already out: nothing moves, nothing is announced

form.fill('email', 'ada@example.com')
form.invalidate('email', 'That address is already registered')
form.errors // [{ field: 'email', message: 'That address is already registered' }]

form.disable('email')
form.errors // [] — the failure is held, not lost
form.enable('email')
form.errors // [{ field: 'email', message: 'That address is already registered' }]

try {
	form.disable(['email', 'nope'])
} catch {
	// Coded FIELD. Every name is checked first, so `email` never left the form.
}
form.disabled.has('email') // false

form.clear()
Array.from(form.disabled) // ['legacy'] — back to the declaration
form.values // { legacy: 'kept' } — and the answers went back with it
moved // ['disable nickname', 'fill email', 'disable email', 'enable email'] — `clear` added nothing
```

The same set travels to the pure helpers. `evaluateForm` takes `EvaluationOptions`, whose `disabled`
**replaces** the schema's declarations rather than adding to them, because a live form always
supplies its own current set, and the schema's declarations beside it would disagree.

```ts
import { evaluateForm } from '@orkestrel/form'
import type { FormSchema } from '@orkestrel/form'

const schema: FormSchema = {
	fields: [
		{ control: 'text', name: 'card', rule: { required: true } },
		{ control: 'text', name: 'email', rule: { required: true } },
	],
}

evaluateForm(schema, {}, { disabled: new Set(['card']) })
// [{ field: 'email', message: 'This field is required', rule: 'required' }]
evaluateForm(schema, {}, { messages: { required: 'Needed' }, disabled: new Set(['card']) })
// [{ field: 'email', message: 'Needed', rule: 'required' }]
```

### Filling, clearing, and failing from outside

`fill` takes either one name and one value, or a whole record. Every answer is checked before any is
written, so a refused write changes nothing. Passing `undefined` clears one field.

`invalidate` fails a field for a reason the rules cannot see — an address already registered, a
coupon already spent. One field holds one external failure, a second call replaces the first, and
the failure lasts until that field is filled again or the form is cleared.

`baseline` is those opening answers, held as a value: the schema's defaults overlaid with any seeded
`values`, fixed when the form opens and never moved again. It is what `dirty` measures against and
what `clear` returns to, so a host that wants to know _which_ answers moved — not merely that one
did — reads `extractChanges(form.values, form.baseline)` and gets the names.

`clear` returns every answer to `baseline`. It also clears `touched`, every external failure, and
every runtime `disable` or `enable`, so the form reads exactly as it opened.

```ts
import { createForm, extractChanges } from '@orkestrel/form'

const form = createForm({
	fields: [
		{ control: 'text', name: 'email', rule: { required: true, email: true } },
		{
			control: 'select',
			name: 'plan',
			choices: [{ value: 'free', label: 'Free' }],
			default: 'free',
		},
	],
})

form.baseline // { plan: 'free' } — the answers it opened with, fixed for its whole life

form.fill('email', 'ada@example.com')
form.valid // true
form.dirty // true
Array.from(extractChanges(form.values, form.baseline)) // ['email'] — which answer moved, by name

form.invalidate('email', 'That address is already registered')
form.errors // [{ field: 'email', message: 'That address is already registered' }]
form.valid // false

form.fill('email', 'grace@example.com')
form.errors // [] — refilling the field clears its external failure

form.clear()
form.values // { plan: 'free' } — back to the answers the form opened with
form.dirty // false
```

### Park-as-Promise: `answer`

`answer` is the form's whole point on a server. It resolves with the submitted values on the first
valid submit, and rejects with a `FormError` coded `ABANDONED` when teardown abandons the form
before it settles. One task can await it while an entirely different task fills and submits the
form, which is what a parked question looks like when a promise is the only thing that has to cross
between them.

Nothing has to await it. An unawaited form that is destroyed does not take the host down with it.

```ts
import { createForm } from '@orkestrel/form'

const form = createForm({ fields: [{ control: 'text', name: 'name', rule: { required: true } }] })

// One task parks on the answer.
const parked = form.answer

// Another task — a request handler, a socket message, a keyboard — supplies it.
form.fill('name', 'Ada')
form.submit()

await parked // { name: 'Ada' }
```

### Abandoning a parked answer

Destroying a form before it settles rejects every parked `answer` with a `FormError` coded
`ABANDONED`, which the parked task recovers through `isFormError`.

```ts
import { createForm, isFormError } from '@orkestrel/form'

const abandoned = createForm({ fields: [{ control: 'text', name: 'name' }] })
const pending = abandoned.answer

abandoned.destroy()
abandoned.status // 'abandoned'

try {
	await pending
} catch (error) {
	if (isFormError(error)) error.code // 'ABANDONED'
}
```

### Settle once

The first valid submit is the only one. It resolves `answer`, emits `submit`, sets `status` to
`settled`, and every later write — `fill`, `touch`, `invalidate`, `disable`, `enable`, `submit`,
`clear` — throws a `FormError` coded `SETTLED`. A failed submit settles nothing and leaves the form
open.

`destroy` tears the form down. Destroying twice does nothing the second time. A form that already
settled keeps its `settled` status and announces nothing. An editing form turns `abandoned`, rejects
`answer`, and emits `abandon` unless the request was deferred behind a mutation batch that settles
before teardown.

### The submit decision

A `validate` listener can write to the form while a submit is deciding. The rules that follow say
what the submit does about it.

**A submit that changes the error list announces before it decides.** Its own evaluation moves that
list only when a `custom` validator answers differently than it did at the last mutation — every
other rule reads state that only a mutation changes, and every mutation already recomputed. When it
does move, `validate` fires and the listeners run; if any of them wrote, the submit evaluates once
more before deciding.
That is one further evaluation, not a loop until nothing changes.

**One submit can therefore emit `validate` more than once.** A listener that fills, invalidates,
disables, or enables announces its own change as it makes it, so a host counting emissions inside one
submit can see more than one.

**A refusal is the list checked at the decision, not a view of the form.** An evaluation that already
failed stays the answer even when a listener then repairs or disables the field that failed. So
`submit()` can return `{ success: false, error: [...] }` while `form.errors` reads `[]` and `valid`
reads `true` the line after. The returned result is what the submit decided; the form is what the
form holds now.

**A settlement made during listener work wins.** A listener that repairs the form and calls `submit`
itself settles it, and that settlement is what the outer call returns — one `submit` event, one
resolved `answer`, and no evaluation after it.

### Retrying a submit

**`submit` is the commit, not the attempt.** It is the moment this document is finished with, which
is why it settles the form and why nothing may be written afterwards. A network request that can be
refused and tried again is a different act, it belongs to the host, and it happens **before**
`submit` — never inside it.

That gives one sequence, and it is short:

1. **Ask the form the synchronous question.** A submit that fails settles nothing, marks every
   enabled field touched, and leaves `status` at `editing`. Calling it for exactly that is correct
   and repeatable — sync errors are the case a local failed submit is for. Read the errors off the
   returned result rather than off the form: with a `validate` listener that writes, the returned
   result and the form can already disagree, as the preceding section sets out.
2. **Run the attempt against `values`.** The request is the host's: its own timeout, its own retry
   count, its own backoff. The form is not involved and knows nothing about it.
3. **Report a refusal through `invalidate`, not through a submit.** The message lands as a
   `FieldError` on the field it belongs to, `valid` turns false, and the form is still open for the
   person to fix it and for the host to try again.
4. **Call `submit` only once the attempt succeeded.** That commits: `answer` resolves, `submit`
   fires, and the form is terminal.

**`idle`, `submitting`, `succeeded`, and `failed` are the host's request states, not the form's.**
`FormStatus` has a member for each of a document's fates — being answered, finished, abandoned —
and a retried request has none of them. A host that needs those states holds them beside the form,
in whatever it already uses for in-flight requests, so the form never gains a status meaning a
request about it is in the air.

```ts
import { createForm } from '@orkestrel/form'

const form = createForm({
	fields: [{ control: 'text', name: 'email', rule: { required: true, email: true } }],
})

// 1. The synchronous question. Nothing settles, and every enabled field is now touched.
form.submit().success // false
form.status // 'editing'
Array.from(form.touched) // ['email']

form.fill('email', 'ada@example.com')

// 2. The host's own attempt, against the answers the form holds. A real one is a request; this
//    one decides locally so the example runs.
const refused = form.values.email === 'ada@example.com'

// 3. A refusal comes back as an invalidation. The form stays open and retryable.
if (refused) form.invalidate('email', 'That address is already registered')
form.valid // false
form.status // 'editing'

// 4. The attempt that succeeds is the one that commits.
form.fill('email', 'grace@example.com')
form.submit().success // true
form.status // 'settled'
```

## Events

Each event carries what a listener needs to act without reading the form back.

| Event      | Payload                               | Fires                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fill`     | the field's `name`, and its new value | Once per field whose answer actually moved, in the order written. The value is `undefined` when the answer was cleared. A `clear` is the exception; see its row.                                                                                                                                               |
| `validate` | every current `FieldError`            | Whenever the error list's content changes — after a fill, an invalidate, a disable, an enable, a clear, or a submit. Empty when the change was to no errors at all. One submit can fire it more than once: the submit announces its own change, and a listener that writes announces that change too.          |
| `disable`  | the field's `name`                    | Once per field taken out of the form, in schema order. A call that moves nothing announces nothing. A `clear` is the exception; see its row.                                                                                                                                                                   |
| `enable`   | the field's `name`                    | Once per field put back into the form, in schema order. A call that moves nothing announces nothing. A `clear` is the exception; see its row.                                                                                                                                                                  |
| `submit`   | the submitted `FormValues`            | On the submit that settles the form, and only that one.                                                                                                                                                                                                                                                        |
| `clear`    | nothing                               | On a completed `clear`, before any `validate` it caused. `clear` is the whole announcement of the reset: restored answers emit no `fill`, and the overlay reset emits no `disable` or `enable`. A custom-validator throw during reevaluation resets state but emits no `clear` and leaves the previous errors. |
| `abandon`  | nothing                               | On the `destroy` that abandons an unsettled form. Never on a settled one.                                                                                                                                                                                                                                      |

Wire listeners at construction through `FormOptions.on`, or afterwards through the `emitter`. Both
reach the same typed emitter, and a listener that throws is isolated and reported to
`FormOptions.error` rather than breaking its siblings or the form.

```ts
import { createForm } from '@orkestrel/form'

const seen: string[] = []

const form = createForm(
	{ fields: [{ control: 'text', name: 'email', rule: { required: true } }] },
	{
		on: {
			fill: (name, value) => seen.push(`fill ${name} ${String(value)}`),
			validate: (errors) => seen.push(`validate ${errors.length}`),
			submit: () => seen.push('submit'),
		},
		error: (error) => console.error(error),
	},
)

form.emitter.on('abandon', () => seen.push('abandon'))

form.fill('email', 'ada@example.com')
form.submit()

seen // ['fill email ada@example.com', 'validate 0', 'submit']
```

## Wire safety

A schema is data, so it travels. `serializeForm` projects it into JSON — dropping every `custom`
validator and every absent member — and `parseForm` reads unknown JSON back into an owned schema,
refusing anything that is not structurally valid and semantically sound. The round trip is exact for
everything that travels.

```ts
import { parseForm, serializeForm } from '@orkestrel/form'
import type { FormSchema } from '@orkestrel/form'

const schema: FormSchema = {
	name: 'signup',
	label: 'Sign up',
	groups: [{ name: 'account', label: 'Account' }],
	fields: [
		{ control: 'text', name: 'email', group: 'account', rule: { required: true, email: true } },
		{ control: 'checkbox', name: 'topics', choices: [{ value: 'a', label: 'A' }], default: ['a'] },
	],
}

const wire = JSON.stringify(serializeForm(schema))
const received = parseForm(JSON.parse(wire))

JSON.stringify(serializeForm(received ?? schema)) === wire // true
parseForm({ fields: 'not a list' }) // undefined
```

Answers travel too, and they arrive as strings far more often than not — a query string, a form
post, a CSV cell. `parseValue` coerces a numeric string into a `number` for a `number` field, and
`'true'` or `'false'` into a boolean for a `confirm` field, and nothing else. Every other value must
already have its control's shape.

`parseValues` is strict in both directions: an unknown key refuses the whole record, and so does one
value its field's control cannot hold. There is no partial result, because a half-accepted answer
set is worse than a rejected one.

```ts
import { parseValue, parseValues } from '@orkestrel/form'
import type { ConfirmField, FormSchema, NumberField } from '@orkestrel/form'

const age: NumberField = { control: 'number', name: 'age' }
const ok: ConfirmField = { control: 'confirm', name: 'ok' }
const schema: FormSchema = { fields: [age, ok] }

parseValue(age, '42') // 42
parseValue(age, 'abc') // undefined
parseValue(ok, 'true') // true
parseValue(ok, 'yes') // undefined

parseValues(schema, { age: '42', ok: 'true' }) // { age: 42, ok: true }
parseValues(schema, { nope: '1' }) // undefined
```

The guards are the same boundary read one field at a time, and every one of them is total.

```ts
import {
	isFieldChoice,
	isFieldControl,
	isFieldError,
	isFieldRule,
	isFieldValue,
	isFormField,
	isFormGroup,
	isFormSchema,
	isFormStatus,
	isFormValues,
} from '@orkestrel/form'

isFieldControl('datetime') // true
isFieldControl('radio') // false — a radio group is a `select`
isFormStatus('settled') // true
isFieldValue(['a', 'b']) // true
isFieldValue({}) // false
isFieldChoice({ value: 'a', label: 'A' }) // true
isFieldChoice({ value: 'a', label: 'A', colour: 'red' }) // false — an unknown member refuses it
isFieldRule({ required: true, minimum: 8 }) // true
isFormField({ control: 'text', name: 'email' }) // true
isFormField({ control: 'text' }) // false
isFormGroup({ name: 'account', label: 'Account' }) // true
isFormSchema({ fields: [{ control: 'text', name: 'a' }] }) // true
isFormValues({ a: 'b', c: 2 }) // true
isFieldError({ field: 'a', message: 'b', rule: 'required' }) // true
```

### Owning what arrives

The cloners are how a value stops being the caller's. The form clones the schema at construction,
before the structural guard and the audit run, so those checks run against the copy. A caller's
object that answers each read differently cannot pass a check on one value and be stored as
another. A later edit to the caller's object changes nothing inside the form. The form also clones
each list value it stores and each it returns, so no caller ever holds a reference to internal
state. The cloners are exported because a consumer building its own schema store needs the same
guarantee.

```ts
import { cloneChoices, cloneFormField, cloneFormSchema, cloneValue } from '@orkestrel/form'

const topics = ['releases']
const owned = cloneValue(topics)
owned === topics // false
Object.isFrozen(owned) // true
cloneValue('text') // 'text' — a scalar is already its own value

Object.isFrozen(cloneChoices([{ value: 'a', label: 'A' }])) // true
Object.isFrozen(cloneFormField({ control: 'text', name: 'email' })) // true
Object.isFrozen(cloneFormSchema({ fields: [{ control: 'text', name: 'email' }] })) // true
```

### Deriving without a form

The evaluation and derivation helpers are pure and take a schema plus values, so a caller that has
no form — a server checking a posted body, an editor previewing a schema — reaches the same answers
the form would give.

```ts
import {
	appliesRule,
	computeDefaults,
	evaluateForm,
	extractGroups,
	matchesValue,
	matchesValues,
} from '@orkestrel/form'
import type { FormSchema } from '@orkestrel/form'

const schema: FormSchema = {
	groups: [
		{ name: 'account', label: 'Account' },
		{ name: 'unused', label: 'Unused' },
	],
	fields: [
		{ control: 'text', name: 'email', group: 'account', default: 'ada@example.com' },
		{ control: 'confirm', name: 'terms', default: false },
		{ control: 'password', name: 'secret' },
	],
}

computeDefaults(schema) // { email: 'ada@example.com', terms: false } — `password` seeds nothing
extractGroups(schema) // [{ name: 'account', label: 'Account' }] — `unused` is referenced by nobody
evaluateForm(schema, {}) // [] — no field declares a rule
appliesRule('number', 'step') // true
matchesValue(['a'], ['a']) // true
matchesValues({ topics: ['a'] }, { topics: ['a'] }) // true
```

## Methods

The public methods of `FormInterface`, which the `Form` class implements exactly and adds nothing
to. Its readonly data members stay in the preceding `## Surface` rows, in the `Shape` cell before
`plus`, and are not repeated here.

A record of answers and a list of names are checked in full before anything moves, so a refused call
changes nothing.

Every other row in the Surface tables is a data shape, a union, a constant, a function, or an error
class, so none of them carries a method table. `FieldValidator` is a callable function type with one
call signature and no named members.

#### `FormInterface`

| Method       | Returns                    | Summary                                                            |
| ------------ | -------------------------- | ------------------------------------------------------------------ |
| `field`      | `FormField` or `undefined` | Finds one field by name.                                           |
| `fill`       | `void`                     | Answers one field, or several at once.                             |
| `touch`      | `void`                     | Records that somebody has visited a field.                         |
| `invalidate` | `void`                     | Fails a field from outside, for what the rules cannot see.         |
| `disable`    | `void`                     | Takes one field, several fields, or every field out of the form.   |
| `enable`     | `void`                     | Puts one field, several fields, or every field back into the form. |
| `submit`     | `FormResult`               | Checks every answer and settles the form when they all pass.       |
| `clear`      | `void`                     | Returns every answer to the ones the form opened with.             |
| `destroy`    | `void`                     | Tears the form down, abandoning it when it has not settled.        |

## Errors

`FormError` carries a machine-readable `code` and an optional structured `context`. Narrow a caught
value with `isFormError` and branch on `code`; never match on message text. A custom validator's own
throw is the caller's exception and escapes unchanged.

| Code        | Raised when                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCHEMA`    | The schema is not a form schema, `auditSchema` found a domain fault, or `cloneFormField` cannot own a field's `meta`. The constructor raises each; `cloneFormField` and `serializeForm` each raise the metadata one on their own. |
| `FIELD`     | A name given to `fill`, `touch`, `invalidate`, `disable`, or `enable` is one the schema does not declare.                                                                                                                         |
| `CONTROL`   | A value written or seeded is one its field's control cannot hold.                                                                                                                                                                 |
| `SETTLED`   | A write reached a form that has already settled.                                                                                                                                                                                  |
| `ABANDONED` | A write reached a form that was destroyed before it settled, or `answer` rejected for that reason.                                                                                                                                |

```ts
import { createForm, isFormError } from '@orkestrel/form'

try {
	createForm({ fields: [{ control: 'text', name: '' }] })
} catch (error) {
	if (isFormError(error)) error.code // 'SCHEMA'
}

const form = createForm({ fields: [{ control: 'number', name: 'age' }] })

try {
	form.fill('nope', 1)
} catch (error) {
	if (isFormError(error)) error.code // 'FIELD'
}

try {
	form.fill('age', 'twelve')
} catch (error) {
	if (isFormError(error)) error.code // 'CONTROL'
}

form.values // {} — a refused write changed nothing
```

`createForm` and `new Form(...)` are the same construction. Prefer the factory at a call site that
only needs `FormInterface`; reach for the class where a class holds a form as its own field and
wants the concrete type.

```ts
import { Form } from '@orkestrel/form'

const form = new Form({ fields: [{ control: 'text', name: 'email', rule: { required: true } }] })
form.fill('email', 'ada@example.com')
form.submit().success // true
```

## Contract

These invariants hold across [`src/core`](../src/core) and this guide.

1. **Documented surface equals exported surface.** Every row in the `## Surface` tables is a real
   barrel export of `src/core`, and every barrel export is a row — both directions, exhaustively.
   Nothing in this module is internal, so the parity suite's internal list is empty.
2. **Documented methods equal interface methods.** The `## Methods` table for `FormInterface` lists
   exactly its call-signature members, and the `Form` class implements every one and adds no public
   behavior beyond them.
3. **The schema is owned before it is read.** `Form` clones the schema at construction and freezes
   every nested group, field, rule, choice, and list. The clone is the only read of the caller's
   object: `isFormSchema` and `auditSchema` both run against the owned copy, and that same copy is
   what the form keeps. A later edit to the caller's object changes nothing inside the form, and no
   getter returns a live internal reference.
4. **Errors are current after completed evaluation.** `errors` is recomputed at construction and
   after every mutation whose evaluation completes, and `validate` fires exactly when that list's
   content changes. A custom-validator throw escapes mid-evaluation. After a throwing `fill`, the
   form holds the new answers beside the pre-fill errors. A throwing `invalidate` records its
   failure but keeps that stale list. A throwing `clear` resets answers, touched fields, and
   invalidations but emits no `clear` and leaves the previous errors. There is no `check`. A failed
   `submit` returns the list it checked at the decision, which is a value rather than a view: after a
   `validate` listener wrote during that submit, `errors` can already differ from it.
5. **`valid` and `dirty` are derived.** Both are computed on read, from `errors` and from the
   answers against `baseline`, so neither can drift from what the form holds. `baseline` itself is
   fixed when the form opens and never moves again.
6. **A write is all-or-nothing.** `fill` checks every answer against its control before writing any,
   and `disable` and `enable` check every name against the schema before any field moves, so a
   `FIELD` or `CONTROL` failure leaves the form exactly as it was.
7. **Settle once, terminally.** The first valid submit resolves `answer`, emits `submit`, and sets
   `status` to `settled`; every later write throws. A destroy not overtaken by an in-flight
   settlement sets `abandoned`, rejects `answer` with `ABANDONED`, and emits `abandon`. The exception
   is a destroy deferred behind a mutation batch that settles before teardown: the form ends
   `settled`, `answer` resolves, and no `abandon` is emitted. Neither end state is left, and every
   getter keeps answering in both. A settlement made by a nested `submit` inside a `validate`
   listener is that one settlement: the outer call returns it, `submit` still fires once, and nothing
   is evaluated after it.
8. **`undefined` is the only absence.** A field is unanswered when `values` holds no key for it, and
   answered otherwise, so `''`, whitespace, `[]`, `false`, and `0` all satisfy `required`. This is
   not HTML's model, which fails `required` on the exact empty string. A binding that wants HTML's
   answer projects at the binding — `fill(name, matchesAnswer(raw) ? raw : undefined)` — and core
   evaluation never applies that projection itself.
9. **A disabled field is out of the form, and the form decides which.** A field that is out is
   neither evaluated nor submitted, while `hidden` and `locked` are rendering facts only and are
   both still evaluated and still submitted. `FieldBase.disabled` is the declaration and
   `FormInterface.disabled` is the current fact: `disable` and `enable` move a field either way,
   each announcing once per field that actually moved in schema order, an invalidation is held
   while its field is out and restored when it returns, and `clear` resets the overlay to the
   declarations — announcing that reset with `clear` alone, never with a per-field `disable` or
   `enable`. `auditSchema` therefore holds every field to the same satisfiability standard,
   disabled or not: it reads the schema alone, so no declaration and no runtime set changes a
   diagnostic, and a passing schema carries none of the faults it enumerates whatever is disabled
   at runtime. It claims nothing beyond that list, and `custom` is outside it.
10. **Guards are total and parsers refuse.** No `is*` throws for any input — hostile prototype,
    symbol key, cycle, or depth. No `parse*` throws; each returns `undefined` on refusal. A
    guard-valid value is never refused by its parser, and every parsed result satisfies its guard.
    A pattern within `PATTERN_LIMIT` can still backtrack catastrophically; this package applies no
    time bound, so evaluating an untrusted pattern spends the caller's thread.
11. **Every retained size is budgeted.** `auditSchema` reports a breach of `FIELD_LIMIT`,
    `GROUP_LIMIT`, `CHOICE_LIMIT`, `NAME_LIMIT`, `STRING_LIMIT`, `TEXT_LIMIT`, `NODE_LIMIT`, or
    `PATTERN_LIMIT`, so `createForm` throws `SCHEMA` and `parseForm` refuses; `matchesField` refuses
    a value breaching `STRING_LIMIT` or `LIST_LIMIT` before any regular expression sees it, so
    `fill` and a seeded value throw `CONTROL` and the parsers return `undefined`. `TEXT_LIMIT` and
    `NODE_LIMIT` are whole-schema ceilings, `meta` included, so the per-item limits never multiply.
    They bound retention and the audit's own walk, never the structural read at the parse door,
    which is the transport's to bound. Regular-expression time and a `custom` validator's own work
    stay unbounded too.
12. **Only data crosses the wire.** `serializeForm` drops every `custom` validator on the way out
    and `parseForm` drops every `custom` member on the way in, so no function crosses in either
    direction. Everything that does cross survives the round trip exactly, `meta` verbatim key for
    key: evaluation never reads it, and this package defines no key in it.
13. **`auditSchema` returns diagnostics, not a contract.** The list's emptiness is the promise. The
    wording of its strings is not: never parse them.
14. **The temporal patterns are lexical.** `date`, `time`, and `datetime` values are checked for
    spelling, never against a calendar, so `'2026-02-31'` is a valid `date` value here. Bounds also
    compare lexically, so operands and values must use the same precision; `'09:00'` sorts before
    `'09:00:00'`.

## Concept inventory

What this package deliberately does not do, and where the work goes instead. Each line is a
boundary taken on evidence, not an omission — so a reader can tell a boundary from a gap, and the
next change knows what it is reopening. `Layer` names who owns the concept, and a row reading
**seam** is one this package answers today through a mechanism it already exposes.

| Concept                                | Layer         | Why it sits there                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Derived `hidden`                       | out           | A `hidden` computed from siblings turns a declared fact into a derived one, which puts a recompute pass back in front of every read — the `check` this design removed. `hidden` stays what the schema said.                                                                           |
| Required when a sibling says so        | seam          | `custom` runs after the named rules and on an absent value, so a required-when rule is one validator reading `values`. The unanswered field carries both messages when both fail.                                                                                                     |
| Relevance, when a field stops applying | seam          | A field that no longer applies goes out of the form with `disable` and comes back with `enable`: not evaluated, not submitted, and its invalidation held meanwhile.                                                                                                                   |
| Repeating field arrays                 | out           | A field group answered many times over. It changes `FormValues` from a flat record into a tree, and every rule, guard, parser, and error path with it.                                                                                                                                |
| Wizards and multi-step                 | host          | Pages, ordering, and progress are presentation. A wizard is several forms and a host that sequences them.                                                                                                                                                                             |
| Pagination                             | host          | Sections of one long form are presentation for the same reason a wizard is, and `group` already carries the arrangement a host paginates on.                                                                                                                                          |
| `month` and `week`                     | out           | More temporal controls with more lexical patterns and no new idea. They join when a real consumer asks for one.                                                                                                                                                                       |
| Temporal `step`                        | out           | `step` is number-only. A temporal step means intervals over calendar arithmetic, which is the same calendar this package deliberately does not carry.                                                                                                                                 |
| Presentation hints                     | renderer      | Switch, radio, and range are affordances for questions already modelled as `confirm`, `select`, and `number`. A hint here would be product policy; `meta` is the carrier when a host must ship one anyway. See [Rendering](#rendering) for the catalog category each control maps to. |
| Input masks                            | renderer      | A mask is how characters are typed and shown as they are typed. `pattern` states what the finished value must be, which is the part that has to travel.                                                                                                                               |
| Accessibility IDs                      | renderer      | `label` and `help` are the strings an accessible control needs. The `id`s tying them to inputs belong to the layer that owns the elements and their uniqueness.                                                                                                                       |
| First-error focus                      | renderer      | `errors` is ordered by schema then rule, so the first error is the first entry. Which element takes focus is a decision only a renderer can make.                                                                                                                                     |
| File bytes                             | host          | A `file` value is names. Bytes are a transport concern with a host-specific representation, and putting them in the document would make the document unserializable.                                                                                                                  |
| Async validation                       | host          | Every rule here is synchronous, so `errors` stays current after every mutation. An async check is the host's attempt, reported through `invalidate` on refusal — `submit` is the commit, never the attempt.                                                                           |
| Validation timing and debounce         | host          | `errors` is current after every mutation, so when to _show_ it is policy over `touched` and the host's own timers rather than a mode inside the form.                                                                                                                                 |
| Warnings and first-error-only modes    | host          | Every failure is an error and `errors` carries all of them in order. A severity axis, or a switch that reports only the first, is display policy applied over that list.                                                                                                              |
| Server-error bags                      | host          | A map of field names to server messages is a loop over `invalidate`, which already holds one external failure per field and drops it when the field is refilled.                                                                                                                      |
| Form-level validators                  | seam          | A rule about the form as a whole. `custom` already reads every answer, so the same check runs today attached to the field it would fail.                                                                                                                                              |
| Address lists                          | seam          | `TextField` has no `multiple`: that word already means a list of file names on `FileField`, and one word cannot carry two value shapes. Several addresses is `custom` plus the exported `EMAIL_PATTERN`.                                                                              |
| Group-level disable                    | seam          | `disable` takes no group argument. A host expands a group from the schema in one line, and a second way to name the same set is a second thing to keep consistent.                                                                                                                    |
| Computed fields                        | host          | A field deriving its value from siblings would be a second writer of `values` and could disagree with `fill`. The host computes and fills, so one writer stays one writer.                                                                                                            |
| Async and live choices                 | host          | `choices` is data in the schema. A list fetched or filtered while somebody types is the host building a new schema, which `parseForm` audits for it.                                                                                                                                  |
| Drafts and autosave                    | host          | `values` is readable at any moment and `parseValues` reads a stored record back, so persistence is a host loop over `values` and `parseValues` with the host's own storage and cadence.                                                                                               |
| Undo and history                       | host          | The form holds the answers and `baseline` holds the ones it opened with. A stack of everything in between is a host concern with a host's retention policy.                                                                                                                           |
| Schema migration                       | host          | Versioning a stored schema and moving old answers onto a new one is the host's data problem. `parseForm` and `parseValues` are the gates on each side of it.                                                                                                                          |
| Trim and normalize                     | binding       | The form stores what it is given. Trimming, case folding, and Unicode normalization belong to the binding, and `matchesAnswer` is where a value that is blank after trimming becomes absence.                                                                                         |
| Localization                           | host          | `FormOptions.messages` replaces a rule's copy, and `label` and `help` are the schema author's strings. Locale selection, plurals, and message catalogs are the host's.                                                                                                                |
| Value localization                     | binding       | A `date` value is the control's own ISO string and a `number` is a number. Reading `31/12/2026` or `1.234,5` from a person is the binding's parse, and it fills the parsed value.                                                                                                     |
| Group and choice `meta`                | out           | `meta` is on `FieldBase` alone, because a field carrier is what the first consumer asked for. The exact guards refuse it on `FormGroup` and `FieldChoice` until one asks.                                                                                                             |
| Constraint-API binding                 | `src/browser` | Reflecting `required` and `minimum` onto real elements, and reading `validity` back, is binding work. It belongs where the elements are.                                                                                                                                              |
| `FormData` and duplicate names         | `src/browser` | Several values under one name, the submitter button, and the `FormData` encoding are host wire formats. `FormValues` holds one answer per field name by design.                                                                                                                       |
| Browser binding                        | `src/browser` | Binding a schema to real elements belongs in a future `src/browser`, taking a form and an element. It is not in this round because nothing renders here yet.                                                                                                                          |
| Terminal adoption                      | terminal      | A terminal driver parking a whole form rather than one prompt belongs in the terminal package, on the same `answer` promise this document already exposes.                                                                                                                            |

## Tests

- [`tests/guides.test.ts`](../tests/guides.test.ts) — the `## Surface` ↔ barrel bijection, the
  `FormInterface` ↔ `Form` method bijection, and the equality gate: every `Summary` cell against its
  declaration's description paragraph, the titled `Open a form, answer it, and settle it` fence
  against the `@example` block of that title (pinned so the titled pair cannot be retired silently),
  and the README pitch against this guide's tagline. It also runs the preceding flagship fences
  against the real source, so a documented value that the code contradicts fails.
- [`tests/src/core/Form.test.ts`](../tests/src/core/Form.test.ts) — construction, state, `baseline`,
  `fill`, `touch`, `invalidate`, `disable`, `enable`, `submit`, `clear`, `destroy`, and the rule
  paths through the entity.
- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — `matchesField`,
  `matchesAnswer`, `appliesRule`, `evaluateField`, `evaluateForm`, `computeDefaults`,
  `matchesValue`, `extractChanges`, `matchesValues`, `formatMessage`, `createFieldError`,
  `defineEntry`, `freezeEntry`, `serializeForm`, `extractGroups`, `auditSchema`, the budgets, and
  the control-by-rule matrix.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — every guard against
  valid, off-shape, and hostile input, plus guard/parser soundness in both directions.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts) — `parseValue`,
  `parseValues`, `parseForm`, the wire round trip, and answer parking.
- [`tests/src/core/cloners.test.ts`](../tests/src/core/cloners.test.ts) — every clone is owned,
  frozen, and deep enough that no caller reference survives.
- [`tests/src/core/constants.test.ts`](../tests/src/core/constants.test.ts) — the registries, the
  permitted-member table, the default messages, and each shipped pattern.
- [`tests/src/core/errors.test.ts`](../tests/src/core/errors.test.ts) — `FormError`'s `code` and
  `context`, and `isFormError` narrowing.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createForm` returns a
  working `FormInterface`.
- [`tests/src/core/index.test.ts`](../tests/src/core/index.test.ts) — the barrel resolves every
  documented export.

## See also

- [`AGENTS.md`](../AGENTS.md) — the coding contract this package is written against.
- [`README.md`](README.md) — the guides index.
