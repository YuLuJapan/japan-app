# Specification Quality Checklist: Map

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-28
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Four decisions that would otherwise have been [NEEDS CLARIFICATION] were settled with the user before
  the spec was written: navigation placement (sixth tab, labels shorten at six), scope (whole feature,
  foundational slice + five stories), geocode-on-save behaviour (suggest, traveller confirms), and the
  route to fixing a place with no location (count → list → existing place edit screen). They are recorded
  in the Input line and encoded in FR-003, FR-004, FR-012, FR-020.
- Named technologies from the Monday brief (the mapping library, the tile source, the lookup service, the
  external maps app, the specific header and flag names) were deliberately kept out of the spec and left
  for `/speckit-plan`. Where a constraint of theirs is load-bearing it is stated as a requirement on
  behaviour instead — FR-013 (attribution required by the imagery provider's terms), FR-014 (no
  pre-fetching), FR-001 (rate limit forces an offline run), FR-006 (the site must not deny its own pages
  the position API).
- The foundational slice is written as a scenario block rather than a user story because it is not
  demonstrable to a traveller on its own; it is listed first and marked as blocking.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
