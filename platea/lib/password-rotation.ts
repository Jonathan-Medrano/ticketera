export const PASSWORD_ROTATION_PATH = '/dashboard/actualizar-password'

export function isPasswordRotationPath(pathname: string) {
  return pathname === PASSWORD_ROTATION_PATH || pathname.startsWith(`${PASSWORD_ROTATION_PATH}/`)
}

export function shouldForcePasswordRotation(user: { userType?: string | null; mustChangePassword?: boolean | null } | null | undefined) {
  return (
    (user?.userType === 'empleado' || user?.userType === 'platform_staff' || user?.userType === 'empresa') &&
    user.mustChangePassword === true
  )
}
