// Datos y helpers compartidos sobre pacientes (los usan las solicitudes, el calendario y el panel del A.T.)

// Lo que puede ver el A.T. que recibe una solicitud: quién es el paciente y qué vínculo tiene con la cuenta.
// El diagnóstico y las notas NO van acá: solo los ve el A.T. que ya tiene un acompañamiento, en el detalle del paciente
export const patientPublicSelect = {
  id: true,
  name: true,
  lastName: true,
  dateOfBirth: true,
  relationship: true,
};

// Para listas y agendas alcanza con el nombre
export const patientNameSelect = { id: true, name: true, lastName: true };

export const fullName = (person) => [person?.name, person?.lastName].filter(Boolean).join(" ");

// Fecha de nacimiento como "YYYY-MM-DD" (la columna es DATE: Prisma la devuelve a medianoche UTC)
export const toDateOnly = (date) => (date ? date.toISOString().slice(0, 10) : null);

// Cómo se nombra a quien pide algo: "Ana Pérez" si el paciente es el titular de la cuenta,
// "Laura Pérez (para Juan Pérez)" si la cuenta es de un familiar o tutor
export const requesterLabel = (tutor, patient) =>
  patient.relationship === "SELF" ? fullName(patient) : `${fullName(tutor)} (para ${fullName(patient)})`;

// Prevención de IDOR: el patientId llega del body o de la URL, así que se busca SIEMPRE junto con el
// tutor que sale del token. Devuelve null si no existe o si es de otra cuenta (no se distingue cuál)
export const findOwnPatient = (client, patientId, tutorId, select = patientPublicSelect) =>
  client.patient.findFirst({ where: { id: patientId, tutorId }, select });
