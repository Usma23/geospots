"""Comandos de administración de GeoSpots.

    python -m app.cli crear-admin <usuario> [--nombre "Nombre"]
    python -m app.cli reset-password <usuario>
    python -m app.cli listar

La contraseña se pide por teclado (no queda en el historial). Para uso no interactivo
se puede pasar en la variable de entorno GEOSPOTS_PASSWORD.
Con Docker:  docker exec -it geospots python -m app.cli crear-admin <usuario>
"""
import argparse
import getpass
import os
import sys

from app import auth, storage


def _pedir_password() -> str:
    env = os.environ.get("GEOSPOTS_PASSWORD")
    if env:
        return env
    p1 = getpass.getpass("Contraseña: ")
    p2 = getpass.getpass("Repite la contraseña: ")
    if p1 != p2:
        sys.exit("Las contraseñas no coinciden.")
    return p1


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crear-admin", help="Crea un usuario administrador")
    c.add_argument("usuario")
    c.add_argument("--nombre", default="")
    r = sub.add_parser("reset-password", help="Cambia la contraseña de un usuario (p. ej. si el admin la olvidó)")
    r.add_argument("usuario")
    sub.add_parser("listar", help="Lista los usuarios")
    args = parser.parse_args(argv)

    auth.init_db()
    try:
        if args.cmd == "crear-admin":
            primero = not auth.hay_admin()
            u = auth.crear_usuario(args.usuario, _pedir_password(), args.nombre,
                                   es_admin=True, debe_cambiar_password=False)
            print(f"Administrador '{u['usuario']}' creado (id {u['id']}).")
            if primero:
                movidos = storage.migrar_proyectos_sin_dueno(u["id"])
                if movidos:
                    print(f"Proyectos existentes asignados a '{u['usuario']}': {', '.join(movidos)}")
        elif args.cmd == "reset-password":
            uid = auth.id_por_usuario(args.usuario)
            if uid is None:
                sys.exit(f"No existe el usuario '{args.usuario}'.")
            auth.establecer_password(uid, _pedir_password(), debe_cambiar=False)
            print(f"Contraseña de '{args.usuario}' actualizada; sus sesiones abiertas se cerraron.")
        elif args.cmd == "listar":
            for u in auth.listar_usuarios():
                rol = "admin" if u["es_admin"] else "usuario"
                estado = "activo" if u["activo"] else "inactivo"
                print(f"{u['id']:>4}  {u['usuario']:<20} {rol:<8} {estado:<9} {u['nombre']}")
    except auth.ErrorAuth as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
