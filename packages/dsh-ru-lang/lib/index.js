/**
 * Host half of the Russian language pack.
 *
 * All translation work happens in the browser bundle (`./client`): the client
 * locale service owns the language catalog and the namespace dictionaries.
 * The host entry exists so the package can be mounted as an ordinary Loader
 * entry, which is what makes its `dsh.client` bundle reach the Web GUI.
 */

/** Cordis plugin name shown in logs. */
export const name = 'dsh-ru-lang'

/**
 * Mount the language pack.
 *
 * Intentionally empty: the client half registers the `ru` language definition
 * and every translated namespace as owned effects once the browser boots.
 */
export function apply() {}
