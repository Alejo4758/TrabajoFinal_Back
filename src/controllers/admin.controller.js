import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const REVIEW_STATUSES = ['APPROVED', 'REJECTED'];

// Datos que necesita el panel de administración para revisar un perfil
const profileInclude = {
    user: {
        select: {
            id: true,
            name: true,
            lastName: true,
            email: true,
            documentType: true,
            documentNumber: true,
            emailVerified: true,
            createdAt: true
        }
    },
    documents: {
        orderBy: { createdAt: 'desc' }
    },
    validations: {
        orderBy: { createdAt: 'desc' },
        include: {
            admin: {
                include: {
                    user: { select: { id: true, name: true, lastName: true } }
                }
            }
        }
    },
    localities: { include: { locality: true } },
    especialities: { include: { especiality: true } },
    obrasSociales: { include: { obraSocial: true } },
    experiences: { orderBy: { startDate: 'desc' } },
    availability: { orderBy: { dayOfWeek: 'asc' } }
};

// Aplana las tablas intermedias para que el front reciba arrays de nombres
const formatProfile = (at) => ({
    ...at,
    localities: (at.localities || []).map(l => l.locality?.name).filter(Boolean),
    specialties: (at.especialities || []).map(e => e.especiality?.name).filter(Boolean),
    socialPrograms: (at.obrasSociales || []).map(o => o.obraSocial?.name).filter(Boolean),
    especialities: undefined,
    obrasSociales: undefined
});

// GET /admin/at/pending
export const getPendingATs = async (req, res) => {
    try {
        const profiles = await prisma.profileAT.findMany({
            where: { status: 'PENDING' },
            include: profileInclude,
            orderBy: { id: 'asc' }
        });

        return res.status(200).json({ data: profiles.map(formatProfile) });
    } catch (error) {
        console.error('Error en getPendingATs:', error);
        return res.status(500).json({ error: 'Error al obtener los perfiles pendientes' });
    }
};

// GET /admin/at?status=PENDING|APPROVED|REJECTED (el filtro es opcional)
export const getAllATs = async (req, res) => {
    try {
        const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';

        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'El estado indicado no es válido' });
        }

        const profiles = await prisma.profileAT.findMany({
            where: status ? { status } : {},
            include: profileInclude,
            orderBy: { id: 'desc' }
        });

        return res.status(200).json({ data: profiles.map(formatProfile) });
    } catch (error) {
        console.error('Error en getAllATs:', error);
        return res.status(500).json({ error: 'Error al obtener los perfiles' });
    }
};

// PATCH /admin/at/:id/validation  body: { status, observations }
export const reviewAT = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: 'El ID del perfil debe ser un número válido' });
        }

        const status = typeof req.body?.status === 'string' ? req.body.status.toUpperCase() : '';
        const observations = typeof req.body?.observations === 'string' ? req.body.observations.trim() : '';

        if (!REVIEW_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'El estado de validación no es válido' });
        }

        if (status === 'REJECTED' && !observations) {
            return res.status(400).json({ error: 'Debés indicar el motivo del rechazo' });
        }

        const exists = await prisma.profileAT.findUnique({ where: { id }, select: { id: true } });

        if (!exists) {
            return res.status(404).json({ error: `Perfil no encontrado (ID: ${id})` });
        }

        // El usuario ADMIN puede no tener aún su fila en la tabla Admin
        const admin = await prisma.admin.upsert({
            where: { userId: req.user.userId },
            update: {},
            create: { userId: req.user.userId }
        });

        // Se registra la validación y se actualiza el estado en una sola transacción
        const [, profile] = await prisma.$transaction([
            prisma.validation.create({
                data: {
                    status,
                    observations: observations || null,
                    adminId: admin.id,
                    profileATId: id
                }
            }),
            prisma.profileAT.update({
                where: { id },
                data: { status },
                include: profileInclude
            })
        ]);

        return res.status(200).json({
            message: status === 'APPROVED' ? 'Perfil aprobado correctamente' : 'Perfil rechazado',
            data: formatProfile(profile)
        });
    } catch (error) {
        console.error('Error en reviewAT:', error);
        return res.status(500).json({ error: 'Error al registrar la validación' });
    }
};
