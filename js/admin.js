import supabase from "./supabase.js";

const DOCUMENTS_BUCKET = "documents";
const MAX_PDF_SIZE = 20 * 1024 * 1024;

const postForm = document.querySelector("#post-form");
const eventSelect = document.querySelector("#admin-event");
const eventCodeHelp = document.querySelector("#event-code-help");
const publishButton = document.querySelector("#publish-button");
const publishMessage = document.querySelector("#publish-message");
const logoutButton = document.querySelector("#logout-button");
const adminEmail = document.querySelector("#admin-email");

const titleInput = document.querySelector("#title");
const contentInput = document.querySelector("#content");
const typeSelect = document.querySelector("#type");
const categoryArea = document.querySelector("#category-area");
const categorySelect = document.querySelector("#category");
const pdfArea = document.querySelector("#pdf-area");
const pdfInput = document.querySelector("#pdf");
const currentPdf = document.querySelector("#current-pdf");
const linkArea = document.querySelector("#link-area");
const urlInput = document.querySelector("#url");

const formTitle = document.querySelector("#form-title");
const cancelEditButton = document.querySelector("#cancel-edit-button");

const newsStat = document.querySelector("#news-stat");
const documentsStat = document.querySelector("#documents-stat");
const linksStat = document.querySelector("#links-stat");

const searchPostsInput = document.querySelector("#search-posts");
const filterTypeSelect = document.querySelector("#filter-type");
const reloadPostsButton = document.querySelector("#reload-posts-button");
const postsMessage = document.querySelector("#posts-message");
const adminPostsList = document.querySelector("#admin-posts-list");
const adminPostTemplate = document.querySelector("#admin-post-template");

let currentEventId = null;
let currentEventSlug = null;
let events = [];
let categories = [];
let posts = [];
let editingPostId = null;

function showMessage(element, text, kind = "") {
  element.textContent = text;
  element.className = "message";

  if (kind) {
    element.classList.add(`message--${kind}`);
  }
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(dateValue));
}

function getTypeLabel(type) {
  if (type === "document") {
    return "Documento";
  }

  if (type === "link") {
    return "Enlace";
  }

  return "Comunicado";
}

function getTypeIcon(type) {
  if (type === "document") {
    return "📄";
  }

  if (type === "link") {
    return "🔗";
  }

  return "📢";
}

function getPostUrl(post) {
  if (post.type === "document") {
    return post.document_url || post.url || "";
  }

  if (post.type === "link") {
    return post.url || "";
  }

  return "";
}

function getCategoryName(categoryId) {
  if (categoryId == null) {
    return "";
  }

  const category = categories.find(
    (item) => String(item.id) === String(categoryId)
  );

  return category?.name ?? "Categoría desconocida";
}

function updateFormFields() {
  const selectedType = typeSelect.value;
  const isDocument = selectedType === "document";
  const isLink = selectedType === "link";
  const needsCategory = isDocument || isLink;

  categoryArea.hidden = !needsCategory;
  pdfArea.hidden = !isDocument;
  linkArea.hidden = !isLink;

  categorySelect.required = needsCategory;
  urlInput.required = isLink;

  // Al crear un documento el PDF es obligatorio.
  // Al editar, solo es obligatorio si todavía no existe un PDF.
  const editingPost = posts.find(
    (post) => post.id === editingPostId
  );

  const existingDocumentUrl =
    editingPost?.type === "document"
      ? getPostUrl(editingPost)
      : "";

  pdfInput.required =
    isDocument && !existingDocumentUrl;

  if (!isDocument) {
    pdfInput.value = "";
    currentPdf.hidden = true;
    currentPdf.textContent = "";
  } else if (existingDocumentUrl) {
    currentPdf.hidden = false;
    currentPdf.textContent =
      "Ya existe un PDF. Selecciona otro archivo solamente si quieres sustituirlo.";
  } else {
    currentPdf.hidden = true;
    currentPdf.textContent = "";
  }

  if (!isLink) {
    urlInput.value = "";
  }
}

function sanitizeFileName(fileName) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function validatePdf(file) {
  if (!file) {
    throw new Error("Selecciona un archivo PDF.");
  }

  const validExtension =
    file.name.toLowerCase().endsWith(".pdf");

  const validMime =
    file.type === "application/pdf" ||
    file.type === "";

  if (!validExtension || !validMime) {
    throw new Error(
      "El archivo seleccionado no es un PDF válido."
    );
  }

  if (file.size > MAX_PDF_SIZE) {
    throw new Error(
      "El PDF supera el límite de 20 MB."
    );
  }
}

function extractStoragePath(publicUrl) {
  if (!publicUrl) {
    return null;
  }

  const marker = `/storage/v1/object/public/${DOCUMENTS_BUCKET}/`;
  const markerIndex = publicUrl.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const encodedPath =
    publicUrl.slice(markerIndex + marker.length);

  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

async function deleteStoredPdf(publicUrl) {
  const filePath = extractStoragePath(publicUrl);

  if (!filePath) {
    return;
  }

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([filePath]);

  if (error) {
    throw error;
  }
}


async function sendPublicationNotification(post) {
  const typeLabel =
    post.type === "document"
      ? "Nuevo documento"
      : post.type === "link"
        ? "Nuevo enlace"
        : "Nuevo comunicado";

  const { data, error } = await supabase.functions.invoke(
    "send-push",
    {
      body: {
        event_id: currentEventId,
        title: typeLabel,
        body: post.title,
        url: new URL("./index.html", window.location.href).href,
        tag: `post-${post.id}`
      }
    }
  );

  if (error) {
    throw error;
  }

  if (data?.error || data?.success === false) {
    throw new Error(data.error || "La función de avisos devolvió un error.");
  }
}

async function protectPage() {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!session) {
    window.location.replace("./login.html");
    return null;
  }

  adminEmail.textContent =
    `Sesión iniciada como ${session.user.email}`;

  const { data: admin, error: adminError } =
    await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

  if (adminError) {
    throw adminError;
  }

  if (!admin) {
    await supabase.auth.signOut();

    alert(
      "Este usuario no tiene permisos de administrador."
    );

    window.location.replace("./login.html");
    return null;
  }

  return session;
}

async function loadEvents() {
  eventSelect.disabled = true;

  const { data, error } = await supabase
    .from("events")
    .select("id, slug, name, access_code, start_date")
    .order("start_date", { ascending: false });

  if (error) {
    throw error;
  }

  events = data ?? [];
  eventSelect.replaceChildren();

  if (!events.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No hay rallies";
    eventSelect.appendChild(option);
    eventCodeHelp.textContent =
      "Crea primero un rally en la tabla events.";
    return;
  }

  for (const event of events) {
    const option = document.createElement("option");
    option.value = String(event.id);
    option.textContent = event.name;
    eventSelect.appendChild(option);
  }

  eventSelect.disabled = false;
  selectAdminEvent(events[0].id);
}

function selectAdminEvent(eventId) {
  const event = events.find(
    (item) => String(item.id) === String(eventId)
  );

  if (!event) {
    return;
  }

  currentEventId = event.id;
  currentEventSlug = event.slug;
  eventSelect.value = String(event.id);
  eventCodeHelp.textContent =
    event.access_code
      ? `Código público: ${event.access_code}`
      : "Este rally todavía no tiene código público.";

  document.title =
    `Administrar ${event.name} | VRC`;
}

async function loadCategories() {
  categorySelect.disabled = true;
  categorySelect.innerHTML =
    '<option value="">Cargando categorías…</option>';

  const { data, error } = await supabase
    .from("categories")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    throw error;
  }

  categories = data ?? [];

  categorySelect.innerHTML = "";

  if (categories.length === 0) {
    categorySelect.innerHTML =
      '<option value="">No hay categorías disponibles</option>';

    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent =
    "Selecciona una categoría";
  placeholder.selected = true;
  placeholder.disabled = true;

  categorySelect.appendChild(placeholder);

  for (const category of categories) {
    const option = document.createElement("option");

    option.value = String(category.id);
    option.textContent = category.name;

    categorySelect.appendChild(option);
  }

  categorySelect.disabled = false;
}

async function uploadPdf(file) {
  validatePdf(file);

  const safeName = sanitizeFileName(file.name);

  const filePath =
    `${currentEventId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } =
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(filePath, file, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: false
      });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } =
    supabase.storage
      .from(DOCUMENTS_BUCKET)
      .getPublicUrl(filePath);

  if (!publicUrlData?.publicUrl) {
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([filePath]);

    throw new Error(
      "No se pudo obtener la URL pública del PDF."
    );
  }

  return {
    filePath,
    publicUrl: publicUrlData.publicUrl
  };
}

function updateStats() {
  newsStat.textContent = String(
    posts.filter((post) =>
      !post.type || post.type === "news"
    ).length
  );

  documentsStat.textContent = String(
    posts.filter((post) =>
      post.type === "document"
    ).length
  );

  linksStat.textContent = String(
    posts.filter((post) =>
      post.type === "link"
    ).length
  );
}

function getFilteredPosts() {
  const search =
    searchPostsInput.value.trim().toLowerCase();

  const selectedType = filterTypeSelect.value;

  return posts.filter((post) => {
    const normalizedType = post.type || "news";

    const matchesType =
      selectedType === "all" ||
      normalizedType === selectedType;

    const searchableText = [
      post.title,
      post.content,
      getCategoryName(post.category_id)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch =
      !search || searchableText.includes(search);

    return matchesType && matchesSearch;
  });
}

function renderPosts() {
  adminPostsList.replaceChildren();

  const filteredPosts = getFilteredPosts();

  if (filteredPosts.length === 0) {
    showMessage(
      postsMessage,
      posts.length === 0
        ? "Todavía no hay publicaciones."
        : "No hay resultados para estos filtros."
    );

    return;
  }

  showMessage(postsMessage, "");

  for (const post of filteredPosts) {
    const fragment =
      adminPostTemplate.content.cloneNode(true);

    fragment.querySelector(
      ".admin-post__icon"
    ).textContent = getTypeIcon(post.type);

    fragment.querySelector(
      ".admin-post__title"
    ).textContent = post.title;

    fragment.querySelector(
      ".admin-post__type"
    ).textContent = getTypeLabel(post.type);

    const contentElement =
      fragment.querySelector(".admin-post__content");

    if (post.content) {
      contentElement.textContent = post.content;
    } else {
      contentElement.remove();
    }

    const categoryElement =
      fragment.querySelector(".admin-post__category");

    const categoryName =
      getCategoryName(post.category_id);

    if (categoryName) {
      categoryElement.textContent = categoryName;
    } else {
      categoryElement.remove();
    }

    fragment.querySelector(
      ".admin-post__date"
    ).textContent = formatDate(post.created_at);

    const openLink =
      fragment.querySelector(".admin-post__open");

    const postUrl = getPostUrl(post);

    if (postUrl) {
      openLink.href = postUrl;
      openLink.hidden = false;
    }

    fragment.querySelector(
      ".admin-post__edit"
    ).addEventListener("click", () => {
      startEditing(post.id);
    });

    fragment.querySelector(
      ".admin-post__delete"
    ).addEventListener("click", () => {
      deletePost(post.id);
    });

    adminPostsList.append(fragment);
  }
}

async function loadPosts() {
  if (!currentEventId) {
    return;
  }

  reloadPostsButton.disabled = true;
  showMessage(postsMessage, "Cargando publicaciones…");

  try {
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, title, content, type, category_id, url, document_url, created_at"
      )
      .eq("event_id", currentEventId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    posts = data ?? [];

    updateStats();
    renderPosts();
  } catch (error) {
    console.error(error);

    showMessage(
      postsMessage,
      `No se pudieron cargar las publicaciones: ${error.message}`,
      "error"
    );
  } finally {
    reloadPostsButton.disabled = false;
  }
}

function resetForm() {
  editingPostId = null;

  postForm.reset();
  typeSelect.value = "news";

  formTitle.textContent = "Publicar contenido";
  publishButton.textContent = "Publicar";
  cancelEditButton.hidden = true;

  updateFormFields();
  showMessage(publishMessage, "");
}

function startEditing(postId) {
  const post = posts.find((item) => item.id === postId);

  if (!post) {
    return;
  }

  editingPostId = post.id;

  titleInput.value = post.title ?? "";
  contentInput.value = post.content ?? "";
  typeSelect.value = post.type || "news";
  categorySelect.value =
    post.category_id == null
      ? ""
      : String(post.category_id);

  urlInput.value =
    post.type === "link"
      ? post.url ?? ""
      : "";

  pdfInput.value = "";

  formTitle.textContent = "Editar publicación";
  publishButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;

  updateFormFields();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  titleInput.focus();
}

async function deletePost(postId) {
  const post = posts.find((item) => item.id === postId);

  if (!post) {
    return;
  }

  const confirmed = window.confirm(
    `¿Eliminar "${post.title}"? Esta acción no se puede deshacer.`
  );

  if (!confirmed) {
    return;
  }

  showMessage(postsMessage, "Eliminando publicación…");

  try {
    if (post.type === "document") {
      const documentUrl = getPostUrl(post);

      if (documentUrl) {
        await deleteStoredPdf(documentUrl);
      }
    }

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", post.id)
      .eq("event_id", currentEventId);

    if (error) {
      throw error;
    }

    if (editingPostId === post.id) {
      resetForm();
    }

    await loadPosts();

    showMessage(
      postsMessage,
      "Publicación eliminada correctamente.",
      "success"
    );
  } catch (error) {
    console.error(error);

    showMessage(
      postsMessage,
      `No se pudo eliminar: ${error.message}`,
      "error"
    );
  }
}

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentEventId) {
    showMessage(
      publishMessage,
      "No se ha podido identificar el rally.",
      "error"
    );

    return;
  }

  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  const selectedType = typeSelect.value;
  const selectedCategory = categorySelect.value;
  const externalUrl = urlInput.value.trim();

  const editingPost = posts.find(
    (post) => post.id === editingPostId
  );

  if (!title) {
    showMessage(
      publishMessage,
      "Escribe un título antes de guardar.",
      "error"
    );

    titleInput.focus();
    return;
  }

  if (
    (selectedType === "document" ||
      selectedType === "link") &&
    !selectedCategory
  ) {
    showMessage(
      publishMessage,
      "Selecciona una categoría.",
      "error"
    );

    categorySelect.focus();
    return;
  }

  if (selectedType === "link" && !externalUrl) {
    showMessage(
      publishMessage,
      "Escribe la dirección web del enlace.",
      "error"
    );

    urlInput.focus();
    return;
  }

  const selectedPdf = pdfInput.files[0];

  const existingDocumentUrl =
    editingPost?.type === "document"
      ? getPostUrl(editingPost)
      : "";

  if (
    selectedType === "document" &&
    !selectedPdf &&
    !existingDocumentUrl
  ) {
    showMessage(
      publishMessage,
      "Selecciona un archivo PDF.",
      "error"
    );

    pdfInput.focus();
    return;
  }

  publishButton.disabled = true;

  showMessage(
    publishMessage,
    selectedPdf
      ? "Subiendo PDF…"
      : editingPostId
        ? "Guardando cambios…"
        : "Publicando…"
  );

  let uploadedFilePath = null;
  let newDocumentUrl = existingDocumentUrl;

  try {
    if (selectedType === "document" && selectedPdf) {
      const uploadResult = await uploadPdf(selectedPdf);

      uploadedFilePath = uploadResult.filePath;
      newDocumentUrl = uploadResult.publicUrl;

      showMessage(
        publishMessage,
        "PDF subido. Guardando publicación…"
      );
    }

    const postData = {
      event_id: currentEventId,
      title,
      content: content || null,
      type: selectedType,
      category_id:
        selectedType === "news"
          ? null
          : Number(selectedCategory),

      // La aplicación pública ya acepta documentos guardados en url.
      url:
        selectedType === "link"
          ? externalUrl
          : selectedType === "document"
            ? newDocumentUrl
            : null
    };

    if (editingPostId) {
      const { error: updateError } = await supabase
        .from("posts")
        .update(postData)
        .eq("id", editingPostId)
        .eq("event_id", currentEventId);

      if (updateError) {
        throw updateError;
      }

      if (
        selectedPdf &&
        existingDocumentUrl &&
        existingDocumentUrl !== newDocumentUrl
      ) {
        try {
          await deleteStoredPdf(existingDocumentUrl);
        } catch (cleanupError) {
          console.error(
            "La publicación se actualizó, pero no se pudo borrar el PDF anterior:",
            cleanupError
          );
        }
      }

      resetForm();

      showMessage(
        publishMessage,
        "Publicación actualizada correctamente.",
        "success"
      );
    } else {
      const {
        data: insertedPost,
        error: insertError
      } = await supabase
        .from("posts")
        .insert(postData)
        .select("id, title, type")
        .single();

      if (insertError) {
        throw insertError;
      }

      let notificationSent = true;

      try {
        await sendPublicationNotification(insertedPost);
      } catch (notificationError) {
        notificationSent = false;
        console.error(
          "La publicación se guardó, pero falló el aviso push:",
          notificationError
        );
      }

      resetForm();

      showMessage(
        publishMessage,
        notificationSent
          ? "Contenido publicado y solicitud de aviso procesada."
          : "Contenido publicado, pero el aviso no se pudo enviar.",
        notificationSent ? "success" : "error"
      );
    }

    await loadPosts();
  } catch (error) {
    console.error(error);

    if (uploadedFilePath) {
      const { error: cleanupError } =
        await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .remove([uploadedFilePath]);

      if (cleanupError) {
        console.error(
          "No se pudo eliminar el PDF huérfano:",
          cleanupError
        );
      }
    }

    showMessage(
      publishMessage,
      `No se pudo guardar: ${error.message}`,
      "error"
    );
  } finally {
    publishButton.disabled = false;
  }
});

eventSelect.addEventListener("change", async () => {
  selectAdminEvent(eventSelect.value);
  resetForm();
  await loadPosts();
});

typeSelect.addEventListener("change", updateFormFields);

cancelEditButton.addEventListener("click", resetForm);

searchPostsInput.addEventListener("input", renderPosts);
filterTypeSelect.addEventListener("change", renderPosts);
reloadPostsButton.addEventListener("click", loadPosts);

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error(error);

    showMessage(
      publishMessage,
      `No se pudo cerrar la sesión: ${error.message}`,
      "error"
    );

    logoutButton.disabled = false;
    return;
  }

  window.location.replace("./login.html");
});

async function initialize() {
  publishButton.disabled = true;
  reloadPostsButton.disabled = true;

  updateFormFields();

  try {
    const session = await protectPage();

    if (!session) {
      return;
    }

    await loadEvents();
    await loadCategories();
    await loadPosts();

    publishButton.disabled = false;
  } catch (error) {
    console.error(error);

    showMessage(
      publishMessage,
      `Error al cargar el panel: ${error.message}`,
      "error"
    );
  }
}

initialize();
