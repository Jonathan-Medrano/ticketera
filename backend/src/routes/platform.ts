import { Router } from 'express'
import { verifyInternal } from '../middleware/auth'
import dashboardRouter from './platform/dashboard'
import empresasRouter from './platform/empresas'
import cobrosRouter from './platform/cobros'
import configuracionRouter from './platform/configuracion'
import usuariosRouter from './platform/usuarios'
import rolesRouter from './platform/roles'
import auditLogsRouter from './platform/audit-logs'
import analiticaRouter from './platform/analitica'
import storageRouter from './platform/storage'
import perfRouter from './platform/perf'
import mensajesRouter from './platform/mensajes'
import meRouter from './platform/me'
import comisionesOverridesRouter from './platform/comisiones-overrides'
import feeTiersRouter from './platform/fee-tiers'
import errorLogsRouter from './platform/error-logs'
import { adminLandingAnnouncementRouter } from './landing-announcement'

const router = Router()

router.use(verifyInternal)
router.use('/me', meRouter)
router.use('/dashboard', dashboardRouter)
router.use('/empresas', empresasRouter)
router.use('/mensajes', mensajesRouter)
router.use('/landing-announcement', adminLandingAnnouncementRouter)
router.use('/cobros', cobrosRouter)
router.use('/configuracion', configuracionRouter)
router.use('/usuarios', usuariosRouter)
router.use('/comisiones-overrides', comisionesOverridesRouter)
router.use('/fee-tiers', feeTiersRouter)
router.use('/roles', rolesRouter)
router.use('/audit-logs', auditLogsRouter)
router.use('/error-logs', errorLogsRouter)
router.use('/analitica', analiticaRouter)
router.use('/storage', storageRouter)
router.use('/perf', perfRouter)
router.use('/', configuracionRouter)

export default router
