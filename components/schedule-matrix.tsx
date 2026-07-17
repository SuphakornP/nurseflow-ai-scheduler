"use client";

import { useMemo } from "react";

import { SHIFT_LABELS, SKILL_LABELS } from "@/lib/constants";
import type { Nurse, ScheduleVersion, ShiftCode } from "@/lib/types";
import { getDates } from "@/lib/utils";

export type DateWindow = "month" | "week-1" | "week-2" | "week-3" | "week-4" | "week-5";

export interface SelectedAssignment {
  nurse: Nurse;
  date: string;
  shift: ShiftCode;
}

interface ScheduleMatrixProps {
  nurses: Nurse[];
  version: ScheduleVersion;
  baselineVersion?: ScheduleVersion;
  dateWindow: DateWindow;
  selected?: SelectedAssignment;
  onSelect: (assignment: SelectedAssignment) => void;
}

const WINDOW_RANGES: Record<DateWindow, [number, number]> = {
  month: [1, 31],
  "week-1": [1, 7],
  "week-2": [8, 14],
  "week-3": [15, 21],
  "week-4": [22, 28],
  "week-5": [29, 31],
};

function assignmentKey(nurseId: string, date: string) {
  return `${nurseId}:${date}`;
}

function formatDateHeader(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  return {
    day: value.getUTCDate(),
    weekday: new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "UTC",
    })
      .format(value)
      .slice(0, 2),
    weekend: value.getUTCDay() === 0 || value.getUTCDay() === 6,
  };
}

export function ScheduleMatrix({
  nurses,
  version,
  baselineVersion,
  dateWindow,
  selected,
  onSelect,
}: ScheduleMatrixProps) {
  const assignmentMap = useMemo(
    () =>
      new Map(
        version.assignments.map((assignment) => [
          assignmentKey(assignment.nurseId, assignment.date),
          assignment.shift,
        ]),
      ),
    [version.assignments],
  );
  const baselineMap = useMemo(
    () =>
      new Map(
        baselineVersion?.assignments.map((assignment) => [
          assignmentKey(assignment.nurseId, assignment.date),
          assignment.shift,
        ]) ?? [],
      ),
    [baselineVersion],
  );

  const dates = getDates("2026-08-01", "2026-08-31");
  const [rangeStart, rangeEnd] = WINDOW_RANGES[dateWindow];
  const visibleDates = dates.filter((date) => {
    const day = Number(date.slice(-2));
    return day >= rangeStart && day <= rangeEnd;
  });
  const rosterDescription = nurses.every((nurse) => nurse.synthetic === true)
    ? "synthetic nickname-only staff records"
    : "nickname-only imported request records";

  return (
    <div className="schedule-scroller" tabIndex={0} aria-label="Schedule matrix scroll area">
      <table className="schedule-table">
        <caption className="sr-only">
          August 2026 nurse schedule for {nurses.length} {rosterDescription}.
        </caption>
        <thead>
          <tr>
            <th className="nurse-column nurse-column--head" scope="col">
              <span>Team</span>
              <small>{nurses.length} nicknames</small>
            </th>
            {visibleDates.map((date) => {
              const header = formatDateHeader(date);
              return (
                <th
                  className={header.weekend ? "date-header is-weekend" : "date-header"}
                  key={date}
                  scope="col"
                >
                  <span>{header.day}</span>
                  <small>{header.weekday}</small>
                  <i aria-label="10 Day and 9 Night staff">10/9</i>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {nurses.map((nurse) => (
            <tr key={nurse.id}>
              <th className="nurse-column" scope="row">
                <span>{nurse.nickname}</span>
                <small>{SKILL_LABELS[nurse.skillLevel]}</small>
              </th>
              {visibleDates.map((date) => {
                const key = assignmentKey(nurse.id, date);
                const shift = assignmentMap.get(key) ?? "OFF";
                const baselineShift = baselineMap.get(key);
                const changed = Boolean(baselineShift && baselineShift !== shift);
                const isSelected =
                  selected?.nurse.id === nurse.id && selected.date === date;
                return (
                  <td className="shift-cell" key={date}>
                    <button
                      className={`shift-token shift-token--${shift.toLowerCase()}${
                        isSelected ? " is-selected" : ""
                      }${changed ? " is-changed" : ""}`}
                      type="button"
                      title={`${nurse.nickname}, ${date}: ${SHIFT_LABELS[shift]}${
                        changed ? ` (changed from ${SHIFT_LABELS[baselineShift!]})` : ""
                      }`}
                      aria-label={`${nurse.nickname}, ${date}, ${SHIFT_LABELS[shift]}${
                        changed ? `, changed from ${SHIFT_LABELS[baselineShift!]}` : ""
                      }`}
                      aria-pressed={isSelected}
                      onClick={() => onSelect({ nurse, date, shift })}
                    >
                      {shift}
                      {changed ? <span className="change-dot" aria-hidden="true" /> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
