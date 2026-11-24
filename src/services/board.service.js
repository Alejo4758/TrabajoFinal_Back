// Recorte del tablero de la red de apoyo: qué datos del acompañamiento recibe un integrante según sus accesos.
// Es el port de scopeBoardData (front: src/utils/boardModel.js) y ES EL CONTROL DE SEGURIDAD: lo que el integrante
// no tiene habilitado no puede viajar en la respuesta, porque cualquier cosa que llegue al navegador se puede leer.
//
// detail = { plan, sessions, reports } con la misma forma que el detalle del paciente del A.T.
// (toPlanResponse y toEncounterResponse) y los informes (toReportResponse). access = ["plan", "sessions", ...]

export const scopeBoardData = (detail, access = []) => {
  const can = (section) => access.includes(section);

  // Con evolución pero sin encuentros: solo la fecha, la hora y la valoración de cada objetivo,
  // sin actividades, observaciones ni notas
  let sessions = [];
  if (can("sessions")) sessions = detail.sessions ?? [];
  else if (can("progress")) {
    sessions = (detail.sessions ?? []).map((session) => ({
      id: session.id,
      date: session.date,
      time: session.time ?? null,
      goals: (session.goals ?? []).map(({ goalId, goalText, level }) => ({ goalId, goalText, level })),
    }));
  }

  // El diagnóstico nunca se comparte con la red. Con evolución pero sin plan: solo los objetivos de cada ámbito,
  // que es lo que la pestaña Evolución necesita para agrupar las valoraciones
  let plan = null;
  if (detail.plan && can("plan")) {
    const { diagnosis, ...rest } = detail.plan;
    void diagnosis;
    plan = rest;
  } else if (detail.plan && can("progress")) {
    plan = {
      stages: (detail.plan.stages ?? []).map((stage) => ({ id: stage.id, specificGoals: stage.specificGoals ?? [] })),
    };
  }

  // Informes: solo los finalizados (el controlador ya los trae filtrados) y solo con el acceso "reports"
  const reports = can("reports") ? detail.reports ?? [] : [];

  return { plan, sessions, reports };
};
