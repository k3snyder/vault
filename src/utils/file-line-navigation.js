export function createPendingLineNavigation(filePath, lineNumber) {
  if (!filePath || !Number.isInteger(lineNumber) || lineNumber <= 0) {
    return null;
  }

  return {
    filePath,
    lineNumber
  };
}

export function takeMatchingLineNavigation(request, filePath) {
  if (!request || request.filePath !== filePath) {
    return {
      nextRequest: request,
      lineNumber: null
    };
  }

  return {
    nextRequest: null,
    lineNumber: request.lineNumber
  };
}

export function applyLineNavigation(editor, lineNumber) {
  const view = editor?.view;
  const doc = view?.state?.doc;

  if (!doc || !Number.isInteger(lineNumber) || lineNumber <= 0 || doc.lines <= 0) {
    return false;
  }

  const targetLineNumber = Math.min(lineNumber, doc.lines);
  const line = doc.line(targetLineNumber);

  view.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true
  });

  if (typeof view.focus === 'function') {
    view.focus();
  }

  return true;
}
