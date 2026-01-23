/**
 * Method decorator for automatically serialize return value
 */
export function Serialize() {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const result = await method.apply(this, args)

      // Serialize the result
      if (result === null || result === undefined) {
        return result
      }

      return JSON.parse(JSON.stringify(result))
    }

    return descriptor
  }
}

/**
 * Class decorator for automatically apply @Serialize() for all methods
 */
export function SerializeAll(excludeMethods: string[] = []) {
  return function <T extends { new (...args: any[]): object }>(constructor: T) {
    // Get the prototype of the class
    const prototype = constructor.prototype

    // Get all method names
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== 'constructor' && typeof prototype[name] === 'function' && !excludeMethods.includes(name),
    )

    // Apply @Serialize() for each method
    methodNames.forEach((methodName) => {
      const originalMethod = prototype[methodName]

      prototype[methodName] = async function (...args: any[]) {
        const result = await originalMethod.apply(this, args)

        if (result === null || result === undefined) {
          return result
        }

        return JSON.parse(JSON.stringify(result))
      }
    })

    return constructor
  }
}
